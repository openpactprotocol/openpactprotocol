import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type CryptoKey,
  type JWK,
} from "jose";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  A2A_ERRORS,
  A2AErrorResponseSchema,
  MessageSchema,
  type Message,
} from "@openpactprotocol/protocol";
import { createA2AHandler, type A2AHandler } from "./handler.js";
import type { Db } from "../db/client.js";
import { agentPlatforms, conversations, customers, messages, schema } from "../db/schema.js";
import { seedDatabase } from "../db/seed.js";

const origin = "http://provider.test";
const issuer = "http://localhost:3002";
const defaultAudience = `${origin}/a2a`;
let pglite: PGlite;
let testDb: Db;
let handler: A2AHandler;
let skylineId = "";
let loomId = "";
let bloomId = "";
let signingKey: CryptoKey;
let publicJwk: JWK & { kid: string };
let rsaSigningKey: CryptoKey;
let rsaIssuer = "";
let previousProviderUrl: string | undefined;

type TokenOptions = {
  issuer?: string;
  audience?: string;
  subject?: string;
  signingKey?: CryptoKey | Uint8Array;
  kid?: string;
  algorithm?: "ES256" | "RS256" | "HS256";
  iat?: number;
  exp?: number;
  includeJti?: boolean;
};

async function signToken(options: TokenOptions = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const iat = options.iat ?? now;
  const algorithm = options.algorithm ?? "ES256";
  const key = options.signingKey ?? signingKey;
  const token = new SignJWT({ sub: options.subject ?? "user-1" })
    .setProtectedHeader({ alg: algorithm, kid: options.kid ?? publicJwk.kid, typ: "JWT" })
    .setIssuer(options.issuer ?? issuer)
    .setAudience(options.audience ?? defaultAudience)
    .setIssuedAt(iat)
    .setExpirationTime(options.exp ?? iat + 120);
  if (options.includeJti) token.setJti(randomUUID());
  return token.sign(key);
}

async function call(
  customerId: string,
  path: string,
  method = "POST",
  body?: unknown,
  options: {
    token?: string | null;
    version?: string | null;
    contentType?: string | null;
    audience?: string;
    subject?: string;
    issuer?: string;
  } = {},
): Promise<Response> {
  const url = new URL(`${origin}/a2a/${customerId}${path ? `/${path}` : ""}`);
  const headers = new Headers();
  const token =
    options.token === null
      ? undefined
      : (options.token ??
        (await signToken({
          audience: options.audience,
          subject: options.subject,
          issuer: options.issuer,
        })));
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (options.version !== null) headers.set("A2A-Version", options.version ?? "1.0");
  if (options.contentType !== null && body !== undefined) {
    headers.set("Content-Type", options.contentType ?? "application/json");
  }
  const requestBody =
    body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body);
  const request = new Request(url, {
    method,
    headers,
    ...(requestBody === undefined ? {} : { body: requestBody }),
  });
  const route = path.split("?", 1)[0] ?? "";
  return handler(request, customerId, route ? route.split("/").filter(Boolean) : []);
}

function sendBody(
  text: string,
  options: {
    messageId?: string;
    contextId?: string;
    taskId?: string;
    role?: string;
    parts?: unknown[];
  } = {},
): unknown {
  return {
    message: {
      messageId: options.messageId ?? randomUUID(),
      ...(options.contextId === undefined ? {} : { contextId: options.contextId }),
      ...(options.taskId === undefined ? {} : { taskId: options.taskId }),
      role: options.role ?? "ROLE_USER",
      parts: options.parts ?? [{ text }],
    },
  };
}

async function readMessage(response: Response): Promise<Message> {
  return MessageSchema.parse((await response.json()).message);
}

async function expectA2AError(
  response: Response,
  reason: keyof typeof A2A_ERRORS,
  message?: string,
): Promise<void> {
  const { error } = A2AErrorResponseSchema.parse(await response.json());
  const expected = A2A_ERRORS[reason];
  expect(response.status).toBe(expected.httpStatus);
  expect(response.headers.get("content-type")).toBe("application/a2a+json");
  expect(error).toMatchObject({
    code: expected.httpStatus,
    status: expected.status,
    details: [
      {
        "@type": "type.googleapis.com/google.rpc.ErrorInfo",
        reason,
        domain: "a2a-protocol.org",
      },
    ],
  });
  if (message !== undefined) expect(error.message).toBe(message);
}

async function expectUnauthorized(response: Response): Promise<void> {
  expect(response.status).toBe(401);
  expect(await response.text()).toBe("");
  expect(response.headers.get("www-authenticate")).toBe('Bearer realm="a2a"');
}

describe("A2A handler", () => {
  beforeAll(async () => {
    previousProviderUrl = process.env.PROVIDER_URL;
    process.env.PROVIDER_URL = origin;
    process.env.A2A_AUDIENCE = defaultAudience;
    const pair = await generateKeyPair("ES256", { extractable: true });
    signingKey = pair.privateKey;
    publicJwk = (await exportJWK(pair.publicKey)) as JWK & { kid: string };
    publicJwk.kid = "test-es-key";
    publicJwk.alg = "ES256";
    publicJwk.use = "sig";

    const rsaPair = await generateKeyPair("RS256", {
      extractable: true,
      modulusLength: 2048,
    });
    rsaSigningKey = rsaPair.privateKey;
    const rsaJwk = (await exportJWK(rsaPair.publicKey)) as JWK & { kid: string };
    rsaJwk.kid = "test-rsa-key";
    rsaJwk.alg = "RS256";
    rsaJwk.use = "sig";

    pglite = new PGlite();
    const database = drizzle(pglite, { schema });
    await migrate(database, {
      migrationsFolder: new URL("../../drizzle", import.meta.url).pathname,
    });
    testDb = database as unknown as Db;
    const seeded = await seedDatabase(testDb, issuer);
    skylineId = seeded.skylineId;
    loomId = seeded.loomId;
    bloomId = seeded.bloomId;
    rsaIssuer = `${issuer}/rsa-platform`;
    await testDb.insert(agentPlatforms).values({
      name: "rsa-platform",
      issuer: rsaIssuer,
      jwksUri: `${issuer}/.well-known/jwks.json`,
      enabled: true,
      audience: null,
    });
    const localJwks = createLocalJWKSet({ keys: [publicJwk, rsaJwk] });
    handler = createA2AHandler({ db: testDb, getJwks: () => localJwks });
  });

  afterAll(async () => {
    await pglite.close();
    delete process.env.A2A_AUDIENCE;
    if (previousProviderUrl === undefined) delete process.env.PROVIDER_URL;
    else process.env.PROVIDER_URL = previousProviderUrl;
  });

  it("seeds ULID customers and serves the Skyline Airways Agent Card", async () => {
    expect({ skylineId, loomId, bloomId }).toEqual({
      skylineId: "01M3R53Q5SZQ6FQSMSDBSSREAA",
      loomId: "01M3R53Q5WKZ7A0GY4PZ8Y39TB",
      bloomId: "01M3R53Q5WHQ1APYDKBW3NCDG3",
    });
    const customer = await testDb.query.customers.findFirst({
      where: eq(customers.id, skylineId),
    });
    expect(customer?.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(customer?.name).toBe("Skyline Airways");
    const response = await call(skylineId, ".well-known/agent-card.json", "GET", undefined, {
      token: null,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/a2a+json");
    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
    const card = await response.json();
    expect(card.supportedInterfaces).toEqual([
      {
        url: `${origin}/a2a/${skylineId}`,
        protocolBinding: "HTTP+JSON",
        protocolVersion: "1.0",
      },
    ]);
    expect(card.securitySchemes.platformJwt.httpAuthSecurityScheme.description).toBe(
      "JWT signed by a registered Personal Agent platform; aud is the audience assigned by the provider at registration",
    );
    expect(card.name).toBe("Skyline Airways");
    expect(card.description).toBe("Flight status and trip changes.");
    expect(card.skills).toEqual([
      {
        id: "flight-status",
        name: "Flight status",
        description: "Check departure and arrival times for a booked flight.",
        tags: [
          "flight",
          "flights",
          "airline",
          "delay",
          "delayed",
          "departure",
          "boarding",
          "gate",
          "trip",
        ],
        examples: ["Is my Friday flight on time?"],
      },
    ]);
    const unknown = await call(
      "missing-customer",
      ".well-known/agent-card.json",
      "GET",
      undefined,
      {
        token: null,
      },
    );
    expect(unknown.status).toBe(404);
    expect(await unknown.text()).toBe("");
  });

  it("lists each seeded business profile skill on its Agent Card", async () => {
    for (const [customerId, expectedSkill] of [
      [skylineId, "flight-status"],
      [loomId, "order-status"],
      [bloomId, "flower-orders"],
    ] as const) {
      const response = await call(customerId, ".well-known/agent-card.json", "GET", undefined, {
        token: null,
      });
      expect(response.status).toBe(200);
      expect((await response.json()).skills[0]?.id).toBe(expectedSkill);
    }
  });

  it("returns bare 404s for unknown route and method combinations before authentication", async () => {
    for (const [method, path] of [
      ["GET", "unknown"],
      ["POST", "unknown"],
      ["GET", "message:send"],
      ["DELETE", "message:send"],
      ["PUT", "message:send"],
      ["POST", "tasks"],
      ["GET", "tasks/task-1:cancel"],
      ["GET", "tasks/task-1:subscribe"],
      ["DELETE", "tasks/task-1/pushNotificationConfigs"],
      ["POST", "tasks/task-1/pushNotificationConfigs/config-1"],
    ]) {
      const response = await call(skylineId, path, method, undefined, { token: null });
      expect(response.status).toBe(404);
      expect(await response.text()).toBe("");
    }
  });

  it("authenticates before looking up customers and supports platform-wide audiences", async () => {
    const missingToken = await call(skylineId, "tasks", "GET", undefined, { token: null });
    await expectUnauthorized(missingToken);
    await expectUnauthorized(await call(skylineId, "message:send", "POST", "{", { token: null }));

    const otherPair = await generateKeyPair("ES256", { extractable: true });
    const badSignature = await call(skylineId, "tasks", "GET", undefined, {
      token: await signToken({ signingKey: otherPair.privateKey }),
    });
    await expectUnauthorized(badSignature);

    const wrongAudience = await call(skylineId, "tasks", "GET", undefined, {
      audience: `${origin}/a2a/${skylineId}`,
    });
    await expectUnauthorized(wrongAudience);

    const now = Math.floor(Date.now() / 1000);
    const futureIssued = await call(skylineId, "tasks", "GET", undefined, {
      token: await signToken({ iat: now + 31, exp: now + 151 }),
    });
    await expectUnauthorized(futureIssued);

    const expired = await call(skylineId, "tasks", "GET", undefined, {
      token: await signToken({ iat: now - 200, exp: now - 100 }),
    });
    await expectUnauthorized(expired);

    const tooLong = await call(skylineId, "tasks", "GET", undefined, {
      token: await signToken({ iat: now, exp: now + 301 }),
    });
    await expectUnauthorized(tooLong);

    const disabled = await call(skylineId, "tasks", "GET", undefined, {
      issuer: `${issuer}/disabled-pa`,
    });
    await expectUnauthorized(disabled);

    const hmac = await call(skylineId, "tasks", "GET", undefined, {
      token: await signToken({
        algorithm: "HS256",
        signingKey: new TextEncoder().encode("not-an-allowed-platform-key"),
      }),
    });
    await expectUnauthorized(hmac);

    const acceptedRs256 = await call(skylineId, "tasks", "GET", undefined, {
      issuer: rsaIssuer,
      token: await signToken({
        issuer: rsaIssuer,
        algorithm: "RS256",
        signingKey: rsaSigningKey,
        kid: "test-rsa-key",
      }),
    });
    expect(acceptedRs256.status).toBe(200);

    const sameToken = await signToken();
    expect((await call(skylineId, "tasks", "GET", undefined, { token: sameToken })).status).toBe(
      200,
    );
    expect((await call(loomId, "tasks", "GET", undefined, { token: sameToken })).status).toBe(200);

    const unknownCustomer = await call("missing-customer", "tasks", "GET", undefined, {
      token: sameToken,
    });
    expect(unknownCustomer.status).toBe(404);
    expect(await unknownCustomer.text()).toBe("");
  });

  it("honors an explicitly registered platform audience", async () => {
    const customAudience = "https://platform.example/custom-audience";
    await testDb
      .update(agentPlatforms)
      .set({ audience: customAudience })
      .where(eq(agentPlatforms.name, "demo-pa"));
    expect(
      (await call(skylineId, "tasks", "GET", undefined, { audience: defaultAudience })).status,
    ).toBe(401);
    expect(
      (await call(skylineId, "tasks", "GET", undefined, { audience: customAudience })).status,
    ).toBe(200);
    await testDb
      .update(agentPlatforms)
      .set({ audience: null })
      .where(eq(agentPlatforms.name, "demo-pa"));
  });

  it("returns a Message, accepts missing protocol headers, and makes message retries idempotent", async () => {
    const messageId = randomUUID();
    const requestBody = sendBody("Is my Friday flight on time?", { messageId });
    const first = await call(skylineId, "message:send", "POST", requestBody, {
      version: null,
      contentType: "text/plain",
    });
    expect(first.status).toBe(200);
    expect(first.headers.get("content-type")).toBe("application/a2a+json");
    const firstMessage = await readMessage(first);
    expect(firstMessage).toMatchObject({
      contextId: expect.any(String),
      role: "ROLE_AGENT",
      parts: [{ text: expect.any(String) }],
    });
    expect(firstMessage).not.toHaveProperty("taskId");
    const beforeRetry = await testDb.select().from(messages);
    const retry = await call(
      skylineId,
      "message:send",
      "POST",
      sendBody("Is my Friday flight on time?", { messageId, contextId: firstMessage.contextId }),
    );
    const retryMessage = await readMessage(retry);
    expect(retryMessage.messageId).toBe(firstMessage.messageId);
    expect(await testDb.select().from(messages)).toHaveLength(beforeRetry.length);

    const retryWithoutContext = await call(
      skylineId,
      "message:send",
      "POST",
      sendBody("Is my Friday flight on time?", { messageId }),
    );
    expect((await readMessage(retryWithoutContext)).contextId).not.toBe(firstMessage.contextId);

    const unsupportedHeaders = await call(skylineId, "message:send", "POST", sendBody("flight"), {
      version: "2.0",
      contentType: "text/plain",
    });
    expect(unsupportedHeaders.status).toBe(200);
  });

  it("rejects a duplicate user message when its context has no stored reply yet", async () => {
    const contextId = randomUUID();
    const messageId = randomUUID();
    await testDb.insert(conversations).values({
      id: contextId,
      customerId: skylineId,
      userId: "demo-pa:retry-owner",
      metadata: { flow: {} },
    });
    await testDb.insert(messages).values({
      conversationId: contextId,
      messageId,
      role: "ROLE_USER",
      parts: [{ text: "flight" }],
    });
    await expectA2AError(
      await call(skylineId, "message:send", "POST", sendBody("flight", { messageId, contextId }), {
        subject: "retry-owner",
      }),
      "INVALID_PARAMS",
      "messageId was already received in this context and has no reply yet",
    );
  });

  it("keeps the flight-detail follow-up in a context", async () => {
    const first = await call(
      skylineId,
      "message:send",
      "POST",
      sendBody("Is my Friday flight on time?"),
    );
    const prompt = await readMessage(first);
    expect(prompt.parts).toEqual([{ text: "I can check that. What's your confirmation code?" }]);
    const second = await call(
      skylineId,
      "message:send",
      "POST",
      sendBody("ABC123", { contextId: prompt.contextId }),
    );
    const answer = await readMessage(second);
    expect(answer.contextId).toBe(prompt.contextId);
    expect(answer.parts).toEqual([
      {
        text: "Flight SK 482 on Friday is delayed 4.5 hours. It now leaves SFO at 2:40 PM and lands at O'Hare at 8:50 PM.",
      },
    ]);
  });

  it("hides missing, foreign-user, and foreign-customer contexts behind INVALID_PARAMS", async () => {
    const original = await call(skylineId, "message:send", "POST", sendBody("flight"), {
      subject: "owner",
    });
    const originalMessage = await readMessage(original);
    for (const [customerId, subject] of [
      [skylineId, "another-user"],
      [loomId, "owner"],
    ] as const) {
      const response = await call(
        customerId,
        "message:send",
        "POST",
        sendBody("flight", { contextId: originalMessage.contextId }),
        { subject },
      );
      await expectA2AError(response, "INVALID_PARAMS", "Unknown contextId");
    }
    const unknownContext = await call(
      skylineId,
      "message:send",
      "POST",
      sendBody("flight", { contextId: randomUUID() }),
      { subject: "owner" },
    );
    await expectA2AError(unknownContext, "INVALID_PARAMS", "Unknown contextId");
    const foreignUser = await call(
      skylineId,
      "message:send",
      "POST",
      sendBody("flight", { contextId: originalMessage.contextId }),
      { subject: "another-user" },
    );
    await expectA2AError(foreignUser, "INVALID_PARAMS", "Unknown contextId");
    const foreignCustomer = await call(
      loomId,
      "message:send",
      "POST",
      sendBody("flight", { contextId: originalMessage.contextId }),
      { subject: "owner" },
    );
    await expectA2AError(foreignCustomer, "INVALID_PARAMS", "Unknown contextId");
  });

  it("rejects task IDs, invalid bodies, non-text parts, and blank text with protocol errors", async () => {
    await expectA2AError(
      await call(skylineId, "message:send", "POST", sendBody("flight", { taskId: "task-1" })),
      "TASK_NOT_FOUND",
      "Task not found",
    );
    await expectA2AError(await call(skylineId, "message:send", "POST", "{"), "INVALID_PARAMS");
    await expectA2AError(
      await call(skylineId, "message:send", "POST", { message: { role: "ROLE_USER" } }),
      "INVALID_PARAMS",
    );
    await expectA2AError(
      await call(skylineId, "message:send", "POST", sendBody("flight", { role: "ROLE_AGENT" })),
      "INVALID_PARAMS",
      "Message role must be ROLE_USER",
    );
    await expectA2AError(
      await call(skylineId, "message:send", "POST", sendBody(" ", { messageId: randomUUID() })),
      "INVALID_PARAMS",
      "Message text must not be blank",
    );
    await expectA2AError(
      await call(skylineId, "message:send", "POST", sendBody("", { parts: [{ raw: "aGVsbG8=" }] })),
      "CONTENT_TYPE_NOT_SUPPORTED",
      "Content type not supported",
    );
  });

  it("returns an empty task list and validates pageSize", async () => {
    const listed = await call(skylineId, "tasks?pageSize=12&status=ignored", "GET");
    expect(listed.status).toBe(200);
    expect(listed.headers.get("content-type")).toBe("application/a2a+json");
    expect(await listed.json()).toEqual({
      tasks: [],
      nextPageToken: "",
      pageSize: 12,
      totalSize: 0,
    });
    expect(await (await call(skylineId, "tasks", "GET")).json()).toMatchObject({ pageSize: 50 });
    for (const value of ["0", "101", "1.5", "NaN"]) {
      await expectA2AError(
        await call(skylineId, `tasks?pageSize=${value}`, "GET"),
        "INVALID_PARAMS",
        "Invalid pageSize",
      );
    }
    await expectA2AError(
      await call(skylineId, "tasks?pageSize=1&pageSize=2", "GET"),
      "INVALID_PARAMS",
      "Invalid pageSize",
    );
  });

  it("maps missing task, unsupported, and push notification routes to their A2A errors", async () => {
    const taskId = randomUUID();
    const missingTask = await call(skylineId, `tasks/${taskId}`, "GET");
    await expectA2AError(missingTask, "TASK_NOT_FOUND", `Task not found: ${taskId}`);
    await expectA2AError(
      await call(skylineId, `tasks/${taskId}:cancel`, "POST"),
      "TASK_NOT_FOUND",
      `Task not found: ${taskId}`,
    );

    for (const [method, path] of [
      ["POST", "message:stream"],
      ["POST", "tasks/task-1:subscribe"],
      ["GET", "extendedAgentCard"],
    ]) {
      await expectA2AError(await call(skylineId, path, method), "UNSUPPORTED_OPERATION");
    }
    for (const [method, path] of [
      ["POST", "tasks/task-1/pushNotificationConfigs"],
      ["GET", "tasks/task-1/pushNotificationConfigs"],
      ["GET", "tasks/task-1/pushNotificationConfigs/config-1"],
      ["DELETE", "tasks/task-1/pushNotificationConfigs/config-1"],
    ]) {
      await expectA2AError(await call(skylineId, path, method), "PUSH_NOTIFICATION_NOT_SUPPORTED");
    }
  });

  it("matches percent-encoded operation colons", async () => {
    const response = await call(skylineId, "message%3Asend", "POST", sendBody("flight"));
    expect(response.status).toBe(200);
    expect((await readMessage(response)).role).toBe("ROLE_AGENT");
  });
});

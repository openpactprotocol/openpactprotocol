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
import { A2A_ERRORS, A2AErrorResponseSchema, MessageSchema, type Message } from "@pac2/protocol";
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
let acmeId = "";
let globexId = "";
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
    acmeId = seeded.acmeId;
    globexId = seeded.globexId;
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
    if (previousProviderUrl === undefined) delete process.env.PROVIDER_URL;
    else process.env.PROVIDER_URL = previousProviderUrl;
  });

  it("seeds ULID customers and serves a public Agent Card with the default audience contract", async () => {
    const customer = await testDb.query.customers.findFirst({
      where: eq(customers.id, acmeId),
    });
    expect(customer?.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(customer?.name).toBe("Acme Health");
    const response = await call(acmeId, ".well-known/agent-card.json", "GET", undefined, {
      token: null,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/a2a+json");
    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
    const card = await response.json();
    expect(card.supportedInterfaces).toEqual([
      {
        url: `${origin}/a2a/${acmeId}`,
        protocolBinding: "HTTP+JSON",
        protocolVersion: "1.0",
      },
    ]);
    expect(card.securitySchemes.platformJwt.httpAuthSecurityScheme.description).toBe(
      "JWT signed by a registered Personal Agent platform; aud is the platform's registered audience (default {base}/a2a)",
    );
    expect(card.skills).toEqual([
      {
        id: "faq",
        name: "FAQ",
        description: "Answer questions about hours, location, parking, and insurance.",
        tags: ["faq"],
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

  it("returns bare 404s for unknown route and method combinations before authentication", async () => {
    for (const [method, path] of [
      ["GET", "unknown"],
      ["POST", "unknown"],
      ["GET", "message:send"],
      ["DELETE", "message:send"],
      ["PUT", "message:send"],
      ["POST", "tasks"],
      ["GET", "tasks/task-1:cancel"],
      ["DELETE", "tasks/task-1/pushNotificationConfigs"],
      ["POST", "tasks/task-1/pushNotificationConfigs/config-1"],
    ]) {
      const response = await call(acmeId, path, method, undefined, { token: null });
      expect(response.status).toBe(404);
      expect(await response.text()).toBe("");
    }
  });

  it("authenticates before looking up customers and supports platform-wide audiences", async () => {
    const missingToken = await call(acmeId, "tasks", "GET", undefined, { token: null });
    await expectUnauthorized(missingToken);
    await expectUnauthorized(await call(acmeId, "message:send", "POST", "{", { token: null }));

    const otherPair = await generateKeyPair("ES256", { extractable: true });
    const badSignature = await call(acmeId, "tasks", "GET", undefined, {
      token: await signToken({ signingKey: otherPair.privateKey }),
    });
    await expectUnauthorized(badSignature);

    const wrongAudience = await call(acmeId, "tasks", "GET", undefined, {
      audience: `${origin}/a2a/${acmeId}`,
    });
    await expectUnauthorized(wrongAudience);

    const now = Math.floor(Date.now() / 1000);
    const futureIssued = await call(acmeId, "tasks", "GET", undefined, {
      token: await signToken({ iat: now + 31, exp: now + 151 }),
    });
    await expectUnauthorized(futureIssued);

    const expired = await call(acmeId, "tasks", "GET", undefined, {
      token: await signToken({ iat: now - 200, exp: now - 100 }),
    });
    await expectUnauthorized(expired);

    const disabled = await call(acmeId, "tasks", "GET", undefined, {
      issuer: `${issuer}/disabled-pa`,
    });
    await expectUnauthorized(disabled);

    const hmac = await call(acmeId, "tasks", "GET", undefined, {
      token: await signToken({
        algorithm: "HS256",
        signingKey: new TextEncoder().encode("not-an-allowed-platform-key"),
      }),
    });
    await expectUnauthorized(hmac);

    const acceptedRs256 = await call(acmeId, "tasks", "GET", undefined, {
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
    expect((await call(acmeId, "tasks", "GET", undefined, { token: sameToken })).status).toBe(200);
    expect((await call(globexId, "tasks", "GET", undefined, { token: sameToken })).status).toBe(
      200,
    );

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
      (await call(acmeId, "tasks", "GET", undefined, { audience: defaultAudience })).status,
    ).toBe(401);
    expect(
      (await call(acmeId, "tasks", "GET", undefined, { audience: customAudience })).status,
    ).toBe(200);
    await testDb
      .update(agentPlatforms)
      .set({ audience: null })
      .where(eq(agentPlatforms.name, "demo-pa"));
  });

  it("returns a Message, accepts missing protocol headers, and makes message retries idempotent", async () => {
    const messageId = randomUUID();
    const requestBody = sendBody("What are your hours?", { messageId });
    const first = await call(acmeId, "message:send", "POST", requestBody, {
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
      acmeId,
      "message:send",
      "POST",
      sendBody("What are your hours?", { messageId, contextId: firstMessage.contextId }),
    );
    const retryMessage = await readMessage(retry);
    expect(retryMessage.messageId).toBe(firstMessage.messageId);
    expect(await testDb.select().from(messages)).toHaveLength(beforeRetry.length);

    const retryWithoutContext = await call(
      acmeId,
      "message:send",
      "POST",
      sendBody("What are your hours?", { messageId }),
    );
    expect((await readMessage(retryWithoutContext)).contextId).not.toBe(firstMessage.contextId);

    const unsupportedHeaders = await call(acmeId, "message:send", "POST", sendBody("hours"), {
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
      customerId: acmeId,
      userId: "demo-pa:retry-owner",
      metadata: { flow: {} },
    });
    await testDb.insert(messages).values({
      conversationId: contextId,
      messageId,
      role: "ROLE_USER",
      parts: [{ text: "hours" }],
    });
    await expectA2AError(
      await call(acmeId, "message:send", "POST", sendBody("hours", { messageId, contextId }), {
        subject: "retry-owner",
      }),
      "INVALID_PARAMS",
      "messageId was already received in this context and has no reply yet",
    );
  });

  it("keeps FAQ flow in a context across the topic prompt and answer", async () => {
    const first = await call(
      acmeId,
      "message:send",
      "POST",
      sendBody("Do you have pediatric cardiology?"),
    );
    const prompt = await readMessage(first);
    expect(prompt.parts).toEqual([
      { text: "Which would you like to know about: hours, location, parking, or insurance?" },
    ]);
    const second = await call(
      acmeId,
      "message:send",
      "POST",
      sendBody("hours", { contextId: prompt.contextId }),
    );
    const answer = await readMessage(second);
    expect(answer.contextId).toBe(prompt.contextId);
    expect(answer.parts[0]).toMatchObject({ text: expect.stringContaining("8:00 AM") });
  });

  it("hides missing, foreign-user, and foreign-customer contexts behind INVALID_PARAMS", async () => {
    const original = await call(acmeId, "message:send", "POST", sendBody("hours"), {
      subject: "owner",
    });
    const originalMessage = await readMessage(original);
    for (const [customerId, subject] of [
      [acmeId, "another-user"],
      [globexId, "owner"],
    ] as const) {
      const response = await call(
        customerId,
        "message:send",
        "POST",
        sendBody("hours", { contextId: originalMessage.contextId }),
        { subject },
      );
      await expectA2AError(response, "INVALID_PARAMS", "Unknown contextId");
    }
    const unknownContext = await call(
      acmeId,
      "message:send",
      "POST",
      sendBody("hours", { contextId: randomUUID() }),
      { subject: "owner" },
    );
    await expectA2AError(unknownContext, "INVALID_PARAMS", "Unknown contextId");
    const foreignUser = await call(
      acmeId,
      "message:send",
      "POST",
      sendBody("hours", { contextId: originalMessage.contextId }),
      { subject: "another-user" },
    );
    await expectA2AError(foreignUser, "INVALID_PARAMS", "Unknown contextId");
    const foreignCustomer = await call(
      globexId,
      "message:send",
      "POST",
      sendBody("hours", { contextId: originalMessage.contextId }),
      { subject: "owner" },
    );
    await expectA2AError(foreignCustomer, "INVALID_PARAMS", "Unknown contextId");
  });

  it("rejects task IDs, invalid bodies, non-text parts, and blank text with protocol errors", async () => {
    await expectA2AError(
      await call(acmeId, "message:send", "POST", sendBody("hours", { taskId: "task-1" })),
      "TASK_NOT_FOUND",
      "Task not found",
    );
    await expectA2AError(await call(acmeId, "message:send", "POST", "{"), "INVALID_PARAMS");
    await expectA2AError(
      await call(acmeId, "message:send", "POST", { message: { role: "ROLE_USER" } }),
      "INVALID_PARAMS",
    );
    await expectA2AError(
      await call(acmeId, "message:send", "POST", sendBody("hours", { role: "ROLE_AGENT" })),
      "INVALID_PARAMS",
      "Message role must be ROLE_USER",
    );
    await expectA2AError(
      await call(acmeId, "message:send", "POST", sendBody(" ", { messageId: randomUUID() })),
      "INVALID_PARAMS",
      "Message text must not be blank",
    );
    await expectA2AError(
      await call(acmeId, "message:send", "POST", sendBody("", { parts: [{ raw: "aGVsbG8=" }] })),
      "CONTENT_TYPE_NOT_SUPPORTED",
      "Content type not supported",
    );
  });

  it("returns an empty task list and validates pageSize", async () => {
    const listed = await call(acmeId, "tasks?pageSize=12&status=ignored", "GET");
    expect(listed.status).toBe(200);
    expect(listed.headers.get("content-type")).toBe("application/a2a+json");
    expect(await listed.json()).toEqual({
      tasks: [],
      nextPageToken: "",
      pageSize: 12,
      totalSize: 0,
    });
    expect(await (await call(acmeId, "tasks", "GET")).json()).toMatchObject({ pageSize: 50 });
    for (const value of ["0", "101", "1.5", "NaN"]) {
      await expectA2AError(
        await call(acmeId, `tasks?pageSize=${value}`, "GET"),
        "INVALID_PARAMS",
        "Invalid pageSize",
      );
    }
    await expectA2AError(
      await call(acmeId, "tasks?pageSize=1&pageSize=2", "GET"),
      "INVALID_PARAMS",
      "Invalid pageSize",
    );
  });

  it("maps missing task, unsupported, and push notification routes to their A2A errors", async () => {
    const taskId = randomUUID();
    const missingTask = await call(acmeId, `tasks/${taskId}`, "GET");
    await expectA2AError(missingTask, "TASK_NOT_FOUND", `Task not found: ${taskId}`);
    await expectA2AError(
      await call(acmeId, `tasks/${taskId}:cancel`, "POST"),
      "TASK_NOT_FOUND",
      `Task not found: ${taskId}`,
    );

    for (const [method, path] of [
      ["POST", "message:stream"],
      ["GET", "tasks/task-1:subscribe"],
      ["POST", "tasks/task-1:subscribe"],
      ["GET", "extendedAgentCard"],
    ]) {
      await expectA2AError(await call(acmeId, path, method), "UNSUPPORTED_OPERATION");
    }
    for (const [method, path] of [
      ["POST", "tasks/task-1/pushNotificationConfigs"],
      ["GET", "tasks/task-1/pushNotificationConfigs"],
      ["GET", "tasks/task-1/pushNotificationConfigs/config-1"],
      ["DELETE", "tasks/task-1/pushNotificationConfigs/config-1"],
    ]) {
      await expectA2AError(await call(acmeId, path, method), "PUSH_NOTIFICATION_NOT_SUPPORTED");
    }
  });

  it("matches percent-encoded operation colons", async () => {
    const response = await call(acmeId, "message%3Asend", "POST", sendBody("hours"));
    expect(response.status).toBe(200);
    expect((await readMessage(response)).role).toBe("ROLE_AGENT");
  });
});

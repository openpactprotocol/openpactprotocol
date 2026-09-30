import { generateKeyPair, importJWK, SignJWT, type CryptoKey, type JWK } from "jose";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { A2AErrorResponseSchema } from "@pap/protocol";
import { A2AClient, createPlatformSigner, discoverAgent, type DiscoveredAgent } from "@pap/client";

function readLocalEnv(): void {
  const path = fileURLToPath(new URL("../apps/personal-agent/client/.env.local", import.meta.url));
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match?.[1] && !process.env[match[1]]) {
      process.env[match[1]] = (match[2] ?? "").replace(/^['"]|['"]$/g, "");
    }
  }
}

readLocalEnv();

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for the E2E suite`);
  return value;
}

const providerUrl = (process.env.PROVIDER_URL ?? "http://localhost:3000").replace(/\/+$/, "");
let customerId = "";
let globexId = "";
let issuer = "";
let privateJwk: (JWK & { kid: string }) | undefined;
let cardResult: DiscoveredAgent | undefined;
let multiTurnClient: A2AClient | undefined;

type TokenOptions = {
  signingKey?: CryptoKey | Uint8Array;
  kid?: string;
  issuer?: string;
  audience?: string;
  subject?: string;
  algorithm?: "ES256" | "HS256";
  iat?: number;
  exp?: number;
};

async function signedToken(options: TokenOptions = {}): Promise<string> {
  if (!privateJwk) throw new Error("PA_PRIVATE_JWK is required");
  const algorithm = options.algorithm ?? "ES256";
  const key = options.signingKey ?? (await importJWK(privateJwk, "ES256"));
  const iat = options.iat ?? Math.floor(Date.now() / 1000);
  return new SignJWT({ sub: options.subject ?? `e2e-${crypto.randomUUID()}` })
    .setProtectedHeader({ alg: algorithm, kid: options.kid ?? privateJwk.kid, typ: "JWT" })
    .setIssuer(options.issuer ?? issuer)
    .setAudience(options.audience ?? (process.env.PA_AUDIENCE || `${providerUrl}/a2a`))
    .setIssuedAt(iat)
    .setExpirationTime(options.exp ?? iat + 120)
    .sign(key);
}

async function rawRequest(
  route: string,
  input: {
    customer?: string;
    method?: string;
    token?: string | null;
    body?: unknown;
    version?: string | null;
    contentType?: string | null;
    audience?: string;
    subject?: string;
    issuer?: string;
  } = {},
): Promise<Response> {
  const headers = new Headers();
  const token =
    input.token === null
      ? undefined
      : (input.token ??
        (await signedToken({
          ...(input.audience === undefined ? {} : { audience: input.audience }),
          ...(input.subject === undefined ? {} : { subject: input.subject }),
          ...(input.issuer === undefined ? {} : { issuer: input.issuer }),
        })));
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (input.version !== null) headers.set("A2A-Version", input.version ?? "1.0");
  if (input.body !== undefined && input.contentType !== null) {
    headers.set("Content-Type", input.contentType ?? "application/json");
  }
  const base = `${providerUrl}/a2a/${input.customer ?? customerId}`;
  const body =
    input.body === undefined
      ? undefined
      : typeof input.body === "string"
        ? input.body
        : JSON.stringify(input.body);
  return fetch(`${base}${route ? `/${route}` : ""}`, {
    method: input.method ?? "GET",
    headers,
    ...(body === undefined ? {} : { body }),
  });
}

function messageBody(
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
      messageId: options.messageId ?? crypto.randomUUID(),
      ...(options.contextId === undefined ? {} : { contextId: options.contextId }),
      ...(options.taskId === undefined ? {} : { taskId: options.taskId }),
      role: options.role ?? "ROLE_USER",
      parts: options.parts ?? [{ text }],
    },
  };
}

async function expectA2AError(
  response: Response,
  expected: { httpStatus: number; status: string; reason: string; message?: string },
): Promise<void> {
  const parsed = A2AErrorResponseSchema.parse(await response.json());
  expect(response.status).toBe(expected.httpStatus);
  expect(response.headers.get("content-type")).toBe("application/a2a+json");
  expect(parsed.error).toMatchObject({
    code: expected.httpStatus,
    status: expected.status,
    details: [{ reason: expected.reason, domain: "a2a-protocol.org" }],
    ...(expected.message === undefined ? {} : { message: expected.message }),
  });
}

function client(userId: string): A2AClient {
  if (!cardResult || !privateJwk) throw new Error("The card and PA key must be loaded first");
  return new A2AClient({
    url: cardResult.url,
    signer: createPlatformSigner({ privateJwk, issuer }),
    userId,
    ...(process.env.PA_AUDIENCE ? { audience: process.env.PA_AUDIENCE } : {}),
  });
}

describe.sequential("PAC2 A2A HTTP+JSON E2E", () => {
  beforeAll(() => {
    customerId = requiredEnv("CUSTOMER_ID");
    globexId = requiredEnv("GLOBEX_ID");
    issuer = requiredEnv("PA_ISSUER");
    privateJwk = JSON.parse(requiredEnv("PA_PRIVATE_JWK")) as JWK & { kid: string };
  });

  it("discovers the public Agent Card with the customer-ID interface URL", async () => {
    cardResult = await discoverAgent(providerUrl, customerId);
    expect(cardResult.card.supportedInterfaces[0]).toMatchObject({
      url: `${providerUrl}/a2a/${customerId}`,
      protocolBinding: "HTTP+JSON",
      protocolVersion: "1.0",
    });
    expect(cardResult.card.securitySchemes?.platformJwt).toHaveProperty(
      "httpAuthSecurityScheme.scheme",
      "Bearer",
    );
    expect(cardResult.card.securitySchemes?.platformJwt).toHaveProperty(
      "httpAuthSecurityScheme.description",
      "JWT signed by a registered Personal Agent platform; aud is the platform's registered audience (default {base}/a2a)",
    );
    expect(cardResult.card.skills).toEqual([
      {
        id: "faq",
        name: "FAQ",
        description: "Answer questions about hours, location, parking, and insurance.",
        tags: ["faq"],
      },
    ]);
    const unknown = await rawRequest(".well-known/agent-card.json", {
      customer: "unknown-customer",
      token: null,
    });
    expect(unknown.status).toBe(404);
    expect(await unknown.text()).toBe("");
  });

  it("returns Message replies and continues FAQ flow by contextId", async () => {
    const faq = await client("faq-user").sendMessage("What are your hours?");
    expect(faq).toMatchObject({
      role: "ROLE_AGENT",
      contextId: expect.any(String),
      parts: [{ text: expect.any(String) }],
    });
    expect(faq).not.toHaveProperty("taskId");

    multiTurnClient = client("multi-turn-user");
    const prompt = await multiTurnClient.sendMessage("Do you offer pediatric cardiology?");
    expect(prompt.parts).toEqual([
      { text: "Which would you like to know about: hours, location, parking, or insurance?" },
    ]);
    const contextId = prompt.contextId;
    if (!contextId) throw new Error("The clarification reply did not include a contextId");
    const answer = await multiTurnClient.sendMessage("hours", { contextId });
    expect(answer.contextId).toBe(contextId);
    expect(answer.parts[0]).toMatchObject({ text: expect.stringContaining("8:00 AM") });
  });

  it("returns the same reply for a duplicate messageId", async () => {
    const messageId = crypto.randomUUID();
    const subject = `retry-${crypto.randomUUID()}`;
    const first = await rawRequest("message:send", {
      method: "POST",
      subject,
      body: messageBody("What are your hours?", { messageId }),
    });
    const firstMessage = (await first.json()).message as { messageId: string; contextId: string };
    const retry = await rawRequest("message:send", {
      method: "POST",
      subject,
      body: messageBody("What are your hours?", {
        messageId,
        contextId: firstMessage.contextId,
      }),
    });
    expect(((await retry.json()).message as { messageId: string }).messageId).toBe(
      firstMessage.messageId,
    );
  });

  it("rejects contexts owned by another user or customer", async () => {
    const owner = await client("context-owner").sendMessage("hours");
    const contextId = owner.contextId;
    if (!contextId) throw new Error("The owner reply did not include a contextId");
    for (const [customer, subject] of [
      [customerId, "another-user"],
      [globexId, "context-owner"],
    ] as const) {
      const response = await rawRequest("message:send", {
        customer,
        method: "POST",
        subject,
        body: messageBody("hours", { contextId }),
      });
      await expectA2AError(response, {
        httpStatus: 400,
        status: "INVALID_ARGUMENT",
        reason: "INVALID_PARAMS",
        message: "Unknown contextId",
      });
    }
  });

  it("returns empty tasks and validates pageSize", async () => {
    const listed = await rawRequest("tasks?pageSize=20&contextId=ignored&status=ignored");
    expect(await listed.json()).toEqual({
      tasks: [],
      nextPageToken: "",
      pageSize: 20,
      totalSize: 0,
    });
    expect(listed.headers.get("content-type")).toBe("application/a2a+json");
    const defaultList = await rawRequest("tasks");
    expect((await defaultList.json()).pageSize).toBe(50);
    const invalid = await rawRequest("tasks?pageSize=0");
    await expectA2AError(invalid, {
      httpStatus: 400,
      status: "INVALID_ARGUMENT",
      reason: "INVALID_PARAMS",
    });
  });

  it("maps task, unsupported, and push routes to the specified A2A errors", async () => {
    const taskId = crypto.randomUUID();
    for (const [method, route] of [
      ["GET", `tasks/${taskId}`],
      ["POST", `tasks/${taskId}:cancel`],
    ] as const) {
      await expectA2AError(await rawRequest(route, { method }), {
        httpStatus: 404,
        status: "NOT_FOUND",
        reason: "TASK_NOT_FOUND",
        message: `Task not found: ${taskId}`,
      });
    }
    for (const [method, route] of [
      ["POST", "message:stream"],
      ["GET", `tasks/${taskId}:subscribe`],
      ["POST", `tasks/${taskId}:subscribe`],
      ["GET", "extendedAgentCard"],
    ] as const) {
      await expectA2AError(await rawRequest(route, { method }), {
        httpStatus: 400,
        status: "FAILED_PRECONDITION",
        reason: "UNSUPPORTED_OPERATION",
      });
    }
    for (const [method, route] of [
      ["GET", `tasks/${taskId}/pushNotificationConfigs`],
      ["POST", `tasks/${taskId}/pushNotificationConfigs`],
      ["GET", `tasks/${taskId}/pushNotificationConfigs/config-1`],
      ["DELETE", `tasks/${taskId}/pushNotificationConfigs/config-1`],
    ] as const) {
      await expectA2AError(await rawRequest(route, { method }), {
        httpStatus: 400,
        status: "FAILED_PRECONDITION",
        reason: "PUSH_NOTIFICATION_NOT_SUPPORTED",
      });
    }
  });

  it("accepts application/a2a+json and does not require A2A-Version", async () => {
    const response = await rawRequest("message:send", {
      method: "POST",
      body: messageBody("hours"),
      contentType: "application/a2a+json",
      version: null,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/a2a+json");
    const ignoredHeaders = await rawRequest("message:send", {
      method: "POST",
      body: messageBody("hours"),
      contentType: "text/plain",
      version: "2.0",
    });
    expect(ignoredHeaders.status).toBe(200);
    expect(ignoredHeaders.headers.get("content-type")).toBe("application/a2a+json");
  });

  it("returns bare 404 for unmatched route and method combinations before auth", async () => {
    for (const [method, route] of [
      ["GET", "unknown"],
      ["GET", "message:send"],
      ["DELETE", "message:send"],
      ["PUT", "message:send"],
      ["POST", "tasks"],
      ["GET", `tasks/${crypto.randomUUID()}:cancel`],
      ["DELETE", `tasks/${crypto.randomUUID()}/pushNotificationConfigs`],
      ["POST", `tasks/${crypto.randomUUID()}/pushNotificationConfigs/config-1`],
    ] as const) {
      const response = await rawRequest(route, { method, token: null });
      expect(response.status).toBe(404);
      expect(await response.text()).toBe("");
    }
  });

  it("rejects missing tokens, bad signatures, wrong audience, expiry, disabled platforms, and HS256", async () => {
    const missing = await rawRequest("tasks", { token: null });
    expect(missing.status).toBe(401);
    expect(await missing.text()).toBe("");
    expect(missing.headers.get("www-authenticate")).toBe('Bearer realm="a2a"');
    const unauthenticatedBody = await rawRequest("message:send", {
      method: "POST",
      token: null,
      body: "{",
    });
    expect(unauthenticatedBody.status).toBe(401);
    expect(await unauthenticatedBody.text()).toBe("");

    const other = await generateKeyPair("ES256", { extractable: true });
    const badSignature = await rawRequest("tasks", {
      token: await signedToken({
        signingKey: other.privateKey,
        kid: `unpublished-${crypto.randomUUID()}`,
      }),
    });
    expect(badSignature.status).toBe(401);

    const wrongAudience = await rawRequest("tasks", {
      audience: `${providerUrl}/a2a/${customerId}`,
    });
    expect(wrongAudience.status).toBe(401);

    const now = Math.floor(Date.now() / 1000);
    const futureIssued = await rawRequest("tasks", {
      token: await signedToken({ iat: now + 31, exp: now + 151 }),
    });
    expect(futureIssued.status).toBe(401);

    const expired = await rawRequest("tasks", {
      token: await signedToken({ iat: now - 200, exp: now - 100 }),
    });
    expect(expired.status).toBe(401);

    const disabled = await rawRequest("tasks", { issuer: `${issuer}/disabled-pa` });
    expect(disabled.status).toBe(401);

    const hs256 = await rawRequest("tasks", {
      token: await signedToken({
        algorithm: "HS256",
        signingKey: new TextEncoder().encode("not-an-allowed-platform-key"),
      }),
    });
    expect(hs256.status).toBe(401);

    const tokenWithoutJti = await signedToken();
    expect((await rawRequest("tasks", { token: tokenWithoutJti })).status).toBe(200);
    expect((await rawRequest("tasks", { customer: globexId, token: tokenWithoutJti })).status).toBe(
      200,
    );
    const unknownCustomer = await rawRequest("tasks", {
      customer: `missing-${crypto.randomUUID()}`,
      token: tokenWithoutJti,
    });
    expect(unknownCustomer.status).toBe(404);
    expect(await unknownCustomer.text()).toBe("");
  });

  it("rejects taskId, malformed messages, and non-text content", async () => {
    await expectA2AError(
      await rawRequest("message:send", {
        method: "POST",
        body: messageBody("hours", { taskId: "task-1" }),
      }),
      {
        httpStatus: 404,
        status: "NOT_FOUND",
        reason: "TASK_NOT_FOUND",
        message: "Task not found",
      },
    );
    await expectA2AError(await rawRequest("message:send", { method: "POST", body: "{" }), {
      httpStatus: 400,
      status: "INVALID_ARGUMENT",
      reason: "INVALID_PARAMS",
    });
    await expectA2AError(
      await rawRequest("message:send", {
        method: "POST",
        body: messageBody("", { parts: [{ raw: "aGVsbG8=" }] }),
      }),
      {
        httpStatus: 400,
        status: "INVALID_ARGUMENT",
        reason: "CONTENT_TYPE_NOT_SUPPORTED",
      },
    );
  });
});

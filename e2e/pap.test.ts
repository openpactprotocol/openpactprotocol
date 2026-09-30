import { exportJWK, generateKeyPair, importJWK, SignJWT, type CryptoKey, type JWK } from "jose";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { A2AErrorResponseSchema } from "@pap/protocol";
import {
  A2AClient,
  createPlatformSigner,
  discoverAgent,
  registerPlatform,
  type DiscoveredAgent,
} from "@pap/client";

function readLocalEnv(): void {
  const path = fileURLToPath(new URL("../apps/personal-agent/client/.env.local", import.meta.url));
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match?.[1] && !process.env[match[1]])
      process.env[match[1]] = (match[2] ?? "").replace(/^['"]|['"]$/g, "");
  }
}

readLocalEnv();

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for the E2E suite`);
  return value;
}

const providerUrl = (process.env.PROVIDER_URL ?? "http://localhost:3000").replace(/\/+$/, "");
let slug = "";
let globexSlug = "";
let issuer = "";
let jwk: (JWK & { kid: string }) | undefined;
let cardResult: DiscoveredAgent | undefined;
let multiTurnClient: A2AClient | undefined;
let multiTurnTaskId = "";

async function signedToken(input: {
  signKey?: CryptoKey;
  kid?: string;
  iss?: string;
  aud: string;
  sub?: string;
  iat?: number;
  exp?: number;
  jti?: string;
}): Promise<string> {
  if (!jwk) throw new Error("PA_PRIVATE_JWK is required");
  const key = input.signKey ?? (await importJWK(jwk, "ES256"));
  const iat = input.iat ?? Math.floor(Date.now() / 1000);
  return new SignJWT({ sub: input.sub ?? `e2e-${crypto.randomUUID()}` })
    .setProtectedHeader({ alg: "ES256", kid: input.kid ?? jwk.kid, typ: "JWT" })
    .setIssuer(input.iss ?? issuer)
    .setAudience(input.aud)
    .setIssuedAt(iat)
    .setExpirationTime(input.exp ?? iat + 120)
    .setJti(input.jti ?? crypto.randomUUID())
    .sign(key);
}

async function rawRequest(
  url: string,
  input: {
    method?: string;
    token?: string;
    body?: unknown;
    version?: string | null;
    contentType?: string;
  } = {},
): Promise<Response> {
  const headers = new Headers();
  if (input.token) headers.set("Authorization", `Bearer ${input.token}`);
  if (input.version === undefined) headers.set("A2A-Version", "1.0");
  else if (input.version !== null) headers.set("A2A-Version", input.version);
  if (input.body !== undefined || input.contentType) {
    headers.set("Content-Type", input.contentType ?? "application/json");
  }
  return fetch(url, {
    method: input.method ?? "GET",
    headers,
    ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
  });
}

async function expectA2AError(
  response: Response,
  expected: { httpStatus: number; status: string; reason: string },
): Promise<void> {
  const parsed = A2AErrorResponseSchema.parse(await response.json());
  expect(response.status).toBe(expected.httpStatus);
  expect(parsed.error).toMatchObject({
    code: expected.httpStatus,
    status: expected.status,
    details: [{ reason: expected.reason, domain: "a2a-protocol.org" }],
  });
}

function client(userId: string): A2AClient {
  if (!cardResult || !jwk) throw new Error("The agent card and PA key must be loaded first");
  return new A2AClient({
    url: cardResult.url,
    signer: createPlatformSigner({ privateJwk: jwk, issuer }),
    userId,
  });
}

describe.sequential("Personal Agent Protocol HTTP+JSON E2E", () => {
  beforeAll(() => {
    slug = requiredEnv("CUSTOMER_SLUG");
    globexSlug = requiredEnv("GLOBEX_SLUG");
    issuer = requiredEnv("PA_ISSUER");
    jwk = JSON.parse(requiredEnv("PA_PRIVATE_JWK")) as JWK & { kid: string };
  });

  it("discovers the HTTP+JSON card with bearer auth and a single FAQ skill", async () => {
    cardResult = await discoverAgent(providerUrl, slug);
    expect(cardResult.card.supportedInterfaces[0]).toMatchObject({
      url: `${providerUrl}/a2a/${slug}`,
      protocolBinding: "HTTP+JSON",
      protocolVersion: "1.0",
    });
    expect(cardResult.card.securitySchemes?.paPlatformJwt).toHaveProperty(
      "httpAuthSecurityScheme.scheme",
      "Bearer",
    );
    expect(cardResult.card.capabilities).toMatchObject({
      streaming: false,
      pushNotifications: false,
    });
    expect(cardResult.card.skills).toEqual([
      {
        id: "faq",
        name: "FAQ",
        description: "Answer questions about hours, location, parking, and insurance.",
        tags: ["faq"],
      },
    ]);
  });

  it("registers the configured platform and reports whether it was created", async () => {
    const signer = createPlatformSigner({ privateJwk: jwk!, issuer });
    const endpoint = `${providerUrl}/api/platforms`;
    const originalFetch = globalThis.fetch;
    let responseStatus: number | undefined;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const response = await originalFetch(input, init);
      if (String(input) === endpoint) responseStatus = response.status;
      return response;
    });
    try {
      const result = await registerPlatform({
        providerUrl,
        name: process.env.PA_PLATFORM_NAME || "demo-pa",
        signer,
      });
      expect([200, 201]).toContain(responseStatus);
      expect(result.created).toBe(responseStatus === 201);
      expect(result.platform).toMatchObject({
        name: process.env.PA_PLATFORM_NAME || "demo-pa",
        issuer,
        enabled: true,
      });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("rejects platform registration when the key is absent from the JWKS", async () => {
    const { privateKey } = await generateKeyPair("ES256", { extractable: true });
    const privateJwk = await exportJWK(privateKey);
    privateJwk.kid = `unpublished-${crypto.randomUUID()}`;
    const signer = createPlatformSigner({ privateJwk, issuer });
    await expect(
      registerPlatform({
        providerUrl,
        name: `e2e-unpublished-${crypto.randomUUID()}`,
        signer,
      }),
    ).rejects.toMatchObject({ status: 401, message: "Unauthorized" });
  });

  it("rejects cross-origin JWKS URIs and a name owned by another issuer", async () => {
    const signer = createPlatformSigner({ privateJwk: jwk!, issuer });
    await expect(
      registerPlatform({
        providerUrl,
        name: `e2e-cross-origin-${crypto.randomUUID()}`,
        jwksUri: "https://another-origin.example/.well-known/jwks.json",
        signer,
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      registerPlatform({ providerUrl, name: "disabled-pa", signer }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("answers a recognized FAQ request", async () => {
    const faq = await client(`e2e-faq-${crypto.randomUUID()}`).sendMessage("What are your hours?");
    expect(faq.task.status.state).toBe("TASK_STATE_COMPLETED");
    expect(faq.task).not.toHaveProperty("contextId");
    expect(faq.task.status.message).not.toHaveProperty("contextId");
    expect(faq.task.status.message?.parts[0]).toMatchObject({
      text: expect.stringContaining("Monday through Friday"),
    });
  });

  it("continues an unrecognized question into the same FAQ task", async () => {
    multiTurnClient = client(`e2e-multiturn-${crypto.randomUUID()}`);
    const started = await multiTurnClient.sendMessage("Can you help me?");
    expect(started.task.status.state).toBe("TASK_STATE_INPUT_REQUIRED");
    expect(started.task).not.toHaveProperty("contextId");
    expect(started.task.status.message?.parts[0]).toMatchObject({
      text: "Which would you like to know about: hours, location, parking, or insurance?",
    });

    multiTurnTaskId = started.task.id;
    const answered = await multiTurnClient.sendMessage("hours", { taskId: multiTurnTaskId });
    expect(answered.task.id).toBe(multiTurnTaskId);
    expect(answered.task.status.state).toBe("TASK_STATE_COMPLETED");
    expect(answered.task.history).toHaveLength(4);
    expect(answered.task).not.toHaveProperty("contextId");
    expect(answered.task.history?.every((message) => !("contextId" in message))).toBe(true);
  });

  it("round-trips context IDs, filters tasks, and rejects context mismatches", async () => {
    const sub = `e2e-context-${crypto.randomUUID()}`;
    const contextId = `context-${crypto.randomUUID()}`;
    const contextClient = client(sub);
    const started = await contextClient.sendMessage("Can you help me?", { contextId });
    expect(started.task.contextId).toBe(contextId);
    expect(started.task.status.state).toBe("TASK_STATE_INPUT_REQUIRED");
    expect(started.task.status.message?.contextId).toBe(contextId);

    const answered = await contextClient.sendMessage("hours", { taskId: started.task.id });
    expect(answered.task.id).toBe(started.task.id);
    expect(answered.task.status.state).toBe("TASK_STATE_COMPLETED");
    expect(answered.task.contextId).toBe(contextId);
    expect(answered.task.history?.every((message) => message.contextId === contextId)).toBe(true);

    const fetched = await contextClient.getTask(answered.task.id);
    expect(fetched.contextId).toBe(contextId);
    expect(fetched.history?.every((message) => message.contextId === contextId)).toBe(true);
    const matching = await contextClient.listTasks({ contextId });
    expect(matching.tasks.map((task) => task.id)).toContain(answered.task.id);
    const filteredOut = await contextClient.listTasks({ contextId: `${contextId}-other` });
    expect(filteredOut.tasks.map((task) => task.id)).not.toContain(answered.task.id);

    const token = await signedToken({ aud: cardResult!.url, sub });
    const mismatch = await rawRequest(`${cardResult!.url}/message:send`, {
      method: "POST",
      token,
      body: {
        message: {
          messageId: crypto.randomUUID(),
          taskId: answered.task.id,
          contextId: `${contextId}-other`,
          role: "ROLE_USER",
          parts: [{ text: "parking" }],
        },
      },
    });
    await expectA2AError(mismatch, {
      httpStatus: 400,
      status: "INVALID_ARGUMENT",
      reason: "INVALID_ARGUMENT",
    });
  });

  it("scopes task reads and cancellation to the caller", async () => {
    if (!multiTurnClient || !multiTurnTaskId) throw new Error("Multi-turn task was not created");
    const differentCaller = client(`e2e-other-${crypto.randomUUID()}`);
    await expect(differentCaller.getTask(multiTurnTaskId)).rejects.toMatchObject({
      httpStatus: 404,
      status: "NOT_FOUND",
      reason: "TASK_NOT_FOUND",
    });
    const otherTasks = await differentCaller.listTasks();
    expect(otherTasks.tasks.some((task) => task.id === multiTurnTaskId)).toBe(false);
    await expect(multiTurnClient.cancelTask(multiTurnTaskId)).rejects.toMatchObject({
      httpStatus: 409,
      status: "FAILED_PRECONDITION",
      reason: "TASK_NOT_CANCELABLE",
    });
  });

  it("returns AIP-193 errors for unsupported operations and invalid query values", async () => {
    const taskId = crypto.randomUUID();
    const cases = [
      ["POST", "/message:stream", undefined, 400, "UNIMPLEMENTED", "UNSUPPORTED_OPERATION"],
      [
        "GET",
        `/tasks/${taskId}:subscribe`,
        undefined,
        400,
        "UNIMPLEMENTED",
        "UNSUPPORTED_OPERATION",
      ],
      ["POST", `/tasks/${taskId}:subscribe`, {}, 400, "UNIMPLEMENTED", "UNSUPPORTED_OPERATION"],
      [
        "GET",
        `/tasks/${taskId}/pushNotificationConfigs`,
        undefined,
        400,
        "UNIMPLEMENTED",
        "UNSUPPORTED_OPERATION",
      ],
      [
        "POST",
        `/tasks/${taskId}/pushNotificationConfigs`,
        {},
        400,
        "UNIMPLEMENTED",
        "UNSUPPORTED_OPERATION",
      ],
      [
        "DELETE",
        `/tasks/${taskId}/pushNotificationConfigs/config-1`,
        undefined,
        400,
        "UNIMPLEMENTED",
        "UNSUPPORTED_OPERATION",
      ],
      [
        "GET",
        "/extendedAgentCard",
        undefined,
        400,
        "FAILED_PRECONDITION",
        "EXTENDED_AGENT_CARD_NOT_CONFIGURED",
      ],
      ["GET", "/tasks?pageSize=1.5", undefined, 400, "INVALID_ARGUMENT", "INVALID_ARGUMENT"],
      ["GET", "/tasks?includeArtifacts=1", undefined, 400, "INVALID_ARGUMENT", "INVALID_ARGUMENT"],
    ] as const;
    for (const [method, path, body, httpStatus, status, reason] of cases) {
      const response = await rawRequest(`${cardResult!.url}${path}`, {
        method,
        token: await signedToken({ aud: cardResult!.url }),
        body,
      });
      await expectA2AError(response, { httpStatus, status, reason });
    }

    const unknownTask = await rawRequest(`${cardResult!.url}/tasks/${taskId}`, {
      token: await signedToken({ aud: cardResult!.url }),
    });
    await expectA2AError(unknownTask, {
      httpStatus: 404,
      status: "NOT_FOUND",
      reason: "TASK_NOT_FOUND",
    });
    const unsupportedContent = await rawRequest(`${cardResult!.url}/message:send`, {
      method: "POST",
      token: await signedToken({ aud: cardResult!.url }),
      contentType: "text/plain",
      body: {},
    });
    await expectA2AError(unsupportedContent, {
      httpStatus: 415,
      status: "INVALID_ARGUMENT",
      reason: "CONTENT_TYPE_NOT_SUPPORTED",
    });
  });

  it("returns empty 404s for unknown routes and wrong methods before auth", async () => {
    for (const [method, path] of [
      ["GET", "/unknown"],
      ["POST", "/unknown"],
      ["PUT", "/message:send"],
      ["GET", "/message:send"],
    ] as const) {
      const response = await rawRequest(`${providerUrl}/a2a/${slug}${path}`, {
        method,
      });
      expect(response.status).toBe(404);
      expect(await response.text()).toBe("");
    }
  });

  it("returns a bare 401 for missing credentials", async () => {
    const response = await rawRequest(`${cardResult!.url}/tasks`);
    expect(response.status).toBe(401);
    expect(await response.text()).toBe("");
    expect(response.headers.get("www-authenticate")).toBe('Bearer realm="a2a"');
  });

  it("rejects a bad signature", async () => {
    const { privateKey } = await generateKeyPair("ES256");
    const token = await signedToken({
      aud: cardResult!.url,
      signKey: privateKey,
      kid: jwk!.kid,
    });
    expect((await rawRequest(`${cardResult!.url}/tasks`, { token })).status).toBe(401);
  });

  it("rejects a token with the wrong audience for the Globex slug", async () => {
    const token = await signedToken({ aud: cardResult!.url });
    const globexUrl = `${providerUrl}/a2a/${globexSlug}/tasks`;
    expect((await rawRequest(globexUrl, { token })).status).toBe(401);
  });

  it("rejects expired tokens", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await signedToken({ aud: cardResult!.url, iat: now - 200, exp: now - 100 });
    expect((await rawRequest(`${cardResult!.url}/tasks`, { token })).status).toBe(401);
  });

  it("rejects tokens with lifetimes over 300 seconds", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await signedToken({ aud: cardResult!.url, iat: now, exp: now + 301 });
    expect((await rawRequest(`${cardResult!.url}/tasks`, { token })).status).toBe(401);
  });

  it("rejects an unknown platform issuer", async () => {
    const token = await signedToken({
      aud: cardResult!.url,
      iss: `${issuer}/not-registered`,
    });
    expect((await rawRequest(`${cardResult!.url}/tasks`, { token })).status).toBe(401);
  });

  it("rejects replayed JWT IDs", async () => {
    const token = await signedToken({ aud: cardResult!.url });
    expect((await rawRequest(`${cardResult!.url}/tasks`, { token })).status).toBe(200);
    expect((await rawRequest(`${cardResult!.url}/tasks`, { token })).status).toBe(401);
  });

  it("rejects the disabled PA platform", async () => {
    const token = await signedToken({
      aud: cardResult!.url,
      iss: `${issuer}/disabled-pa`,
    });
    expect((await rawRequest(`${cardResult!.url}/tasks`, { token })).status).toBe(401);
  });

  it("requires the A2A-Version header after successful authentication", async () => {
    const token = await signedToken({ aud: cardResult!.url });
    const response = await rawRequest(`${cardResult!.url}/tasks`, {
      token,
      version: null,
    });
    await expectA2AError(response, {
      httpStatus: 400,
      status: "UNIMPLEMENTED",
      reason: "VERSION_NOT_SUPPORTED",
    });
  });
});

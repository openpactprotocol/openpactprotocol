import { generateKeyPair, importJWK, SignJWT, type JWK } from "jose";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { A2AClient, createPlatformSigner, discoverAgent } from "@pap/client";

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
let cardResult: Awaited<ReturnType<typeof discoverAgent>> | undefined;
let multiTurnClient: A2AClient | undefined;
let multiTurnTaskId = "";

async function signedToken(input: {
  signKey?: Awaited<ReturnType<typeof importJWK>>;
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

async function rawRpc(
  url: string,
  token: string | undefined,
  params: unknown,
  method = "ListTasks",
): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "A2A-Version": "1.0",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: crypto.randomUUID(), method, params }),
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

describe.sequential("Personal Agent Protocol full E2E", () => {
  beforeAll(() => {
    slug = requiredEnv("CUSTOMER_SLUG");
    globexSlug = requiredEnv("GLOBEX_SLUG");
    issuer = requiredEnv("PA_ISSUER");
    jwk = JSON.parse(requiredEnv("PA_PRIVATE_JWK")) as JWK & { kid: string };
  });

  it("discovers the protocol-core agent card", async () => {
    cardResult = await discoverAgent(providerUrl, slug);
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

  it("answers a recognized FAQ request", async () => {
    const faq = await client(`e2e-faq-${crypto.randomUUID()}`).sendMessage("What are your hours?");
    expect(faq.task.status.state).toBe("TASK_STATE_COMPLETED");
    expect(faq.task).not.toHaveProperty("contextId");
    expect(faq.task.status.message).not.toHaveProperty("contextId");
    expect(faq.task.status.message?.parts[0]).toMatchObject({
      text: expect.stringContaining("Monday through Friday"),
    });
  });

  it("continues an unknown question into the same FAQ task", async () => {
    multiTurnClient = client(`e2e-multiturn-${crypto.randomUUID()}`);
    const started = await multiTurnClient.sendMessage("Can you help me?");
    expect(started.task.status.state).toBe("TASK_STATE_INPUT_REQUIRED");
    expect(started.task).not.toHaveProperty("contextId");
    expect(started.task.status.message).not.toHaveProperty("contextId");
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

  it("round-trips and filters a supplied context ID", async () => {
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
    const mismatch = await rawRpc(
      cardResult!.url,
      token,
      {
        message: {
          messageId: crypto.randomUUID(),
          taskId: answered.task.id,
          contextId: `${contextId}-other`,
          role: "ROLE_USER",
          parts: [{ text: "parking" }],
        },
      },
      "SendMessage",
    );
    expect(await mismatch.json()).toMatchObject({ error: { code: -32602 } });
  });

  it("scopes GetTask and ListTasks to the caller and rejects cancellation", async () => {
    if (!multiTurnClient || !multiTurnTaskId) throw new Error("Multi-turn task was not created");
    const differentCaller = client(`e2e-other-${crypto.randomUUID()}`);
    await expect(differentCaller.getTask(multiTurnTaskId)).rejects.toMatchObject({ code: -32001 });
    const otherTasks = await differentCaller.listTasks();
    expect(otherTasks.tasks.some((task) => task.id === multiTurnTaskId)).toBe(false);
    await expect(multiTurnClient.cancelTask(multiTurnTaskId)).rejects.toMatchObject({
      code: -32002,
    });
  });

  it("rejects requests without a bearer token", async () => {
    const response = await rawRpc(cardResult!.url, undefined, {});
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe('Bearer realm="a2a"');
    expect(await response.json()).toMatchObject({
      error: { code: -32000, message: "Unauthorized" },
    });
  });

  it("rejects a bad signature", async () => {
    const { privateKey } = await generateKeyPair("ES256");
    const token = await signedToken({
      aud: cardResult!.url,
      signKey: privateKey,
      kid: jwk!.kid,
    });
    expect((await rawRpc(cardResult!.url, token, {})).status).toBe(401);
  });

  it("rejects a token with the wrong audience for the Globex slug", async () => {
    const token = await signedToken({ aud: cardResult!.url });
    const globexUrl = `${providerUrl}/a2a/${globexSlug}`;
    expect((await rawRpc(globexUrl, token, {})).status).toBe(401);
  });

  it("rejects expired tokens", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await signedToken({ aud: cardResult!.url, iat: now - 200, exp: now - 100 });
    expect((await rawRpc(cardResult!.url, token, {})).status).toBe(401);
  });

  it("rejects tokens with lifetimes over 300 seconds", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await signedToken({ aud: cardResult!.url, iat: now, exp: now + 301 });
    expect((await rawRpc(cardResult!.url, token, {})).status).toBe(401);
  });

  it("rejects an unknown platform issuer", async () => {
    const token = await signedToken({
      aud: cardResult!.url,
      iss: `${issuer}/not-registered`,
    });
    expect((await rawRpc(cardResult!.url, token, {})).status).toBe(401);
  });

  it("rejects replayed JWT IDs", async () => {
    const token = await signedToken({ aud: cardResult!.url });
    expect((await rawRpc(cardResult!.url, token, {})).status).toBe(200);
    expect((await rawRpc(cardResult!.url, token, {})).status).toBe(401);
  });

  it("rejects the disabled PA platform", async () => {
    const token = await signedToken({
      aud: cardResult!.url,
      iss: `${issuer}/disabled-pa`,
    });
    expect((await rawRpc(cardResult!.url, token, {})).status).toBe(401);
  });

  it("returns version error -32009 when A2A-Version is missing", async () => {
    const token = await signedToken({ aud: cardResult!.url });
    const response = await fetch(cardResult!.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ListTasks", params: {} }),
    });
    expect((await response.json()).error.code).toBe(-32009);
  });
});

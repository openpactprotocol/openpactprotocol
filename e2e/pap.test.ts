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
let disabledSlug = "";
let issuer = "";
let jwk: (JWK & { kid: string }) | undefined;
let username = "";
let password = "";
let cardResult: Awaited<ReturnType<typeof discoverAgent>> | undefined;
let rescheduleClient: A2AClient | undefined;
let rescheduleTaskId = "";

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
  method = "SendMessage",
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
    disabledSlug = requiredEnv("DISABLED_CUSTOMER_SLUG");
    issuer = requiredEnv("PA_ISSUER");
    jwk = JSON.parse(requiredEnv("PA_PRIVATE_JWK")) as JWK & { kid: string };
    username = requiredEnv("ADMIN_USER");
    password = requiredEnv("ADMIN_PASSWORD");
  });

  it("discovers the Acme agent card and only exposes supported skills", async () => {
    cardResult = await discoverAgent(providerUrl, slug);
    expect(cardResult.card.securitySchemes?.paPlatformJwt).toHaveProperty(
      "httpAuthSecurityScheme.scheme",
      "Bearer",
    );
    expect(cardResult.card.skills.map((skill) => skill.id)).toEqual([
      "faq",
      "appointment_lookup",
      "appointment_reschedule",
    ]);
    expect(cardResult.card.skills.some((skill) => skill.id === "billing_dispute")).toBe(false);

    const hiddenCard = await fetch(
      `${providerUrl}/a2a/${encodeURIComponent(disabledSlug)}/.well-known/agent-card.json`,
    );
    expect(hiddenCard.status).toBe(404);
  });

  it("answers a FAQ request", async () => {
    const faq = await client(`e2e-faq-${crypto.randomUUID()}`).sendMessage("What are your hours?");
    expect(faq.task.status.state).toBe("TASK_STATE_COMPLETED");
    expect(faq.task.status.message?.parts[0]).toMatchObject({
      text: expect.stringContaining("Monday through Friday"),
    });
  });

  it("escalates hidden billing and explicit human requests without assigning an AOP", async () => {
    const billingClient = client(`e2e-billing-${crypto.randomUUID()}`);
    const billing = await billingClient.sendMessage("I want to dispute a charge");
    expect(billing.task.status.state).toBe("TASK_STATE_INPUT_REQUIRED");
    expect(billing.task.status.message?.parts[0]).toMatchObject({
      text: expect.stringContaining(
        "I can't help with that over this channel. A human will follow up via Acme Health's normal support channel.",
      ),
    });
    expect(billing.task.metadata?.aopId).toBeNull();
    const persistedBilling = await billingClient.getTask(billing.task.id);
    expect(persistedBilling.metadata?.aopId).toBeNull();

    const human = await client(`e2e-human-${crypto.randomUUID()}`).sendMessage(
      "I want to talk to a human",
    );
    expect(human.task.status.state).toBe("TASK_STATE_INPUT_REQUIRED");
    expect(human.task.status.message?.parts[0]).toMatchObject({
      text: expect.stringContaining(
        "A human will follow up via Acme Health's normal support channel.",
      ),
    });
    expect(human.task.metadata?.aopId).toBeNull();
  });

  it("reschedules an appointment after verification", async () => {
    rescheduleClient = client(`e2e-reschedule-${crypto.randomUUID()}`);
    let reschedule = await rescheduleClient.sendMessage("Please reschedule my appointment");
    expect(reschedule.task.status.state).toBe("TASK_STATE_INPUT_REQUIRED");
    reschedule = await rescheduleClient.sendMessage("jane.doe@example.com 1990-04-12", {
      taskId: reschedule.task.id,
    });
    expect(reschedule.task.status.message?.parts[0]).toMatchObject({
      text: expect.stringContaining("YYYY-MM-DD HH:MM"),
    });
    const futureTime = new Date(Date.now() + 14 * 86_400_000);
    futureTime.setUTCHours(11, 30, 0, 0);
    const localTime = `${futureTime.toISOString().slice(0, 10)} 11:30`;
    reschedule = await rescheduleClient.sendMessage(localTime, { taskId: reschedule.task.id });
    expect(reschedule.task.status.state).toBe("TASK_STATE_COMPLETED");
    const fetched = await rescheduleClient.getTask(reschedule.task.id);
    expect(fetched.status.state).toBe("TASK_STATE_COMPLETED");
    rescheduleTaskId = reschedule.task.id;
  });

  it("scopes tasks to their caller and refuses cancellation", async () => {
    if (!rescheduleClient || !rescheduleTaskId) throw new Error("Reschedule task was not created");
    const differentCaller = client(`e2e-other-${crypto.randomUUID()}`);
    await expect(differentCaller.getTask(rescheduleTaskId)).rejects.toMatchObject({
      code: -32001,
    });
    const otherTasks = await differentCaller.listTasks();
    expect(otherTasks.tasks.some((task) => task.id === rescheduleTaskId)).toBe(false);
    await expect(rescheduleClient.cancelTask(rescheduleTaskId)).rejects.toMatchObject({
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

  it("rejects an incorrect audience", async () => {
    const token = await signedToken({
      aud: `${providerUrl}/a2a/${disabledSlug}`,
    });
    expect((await rawRpc(cardResult!.url, token, {})).status).toBe(401);
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

  it("rejects the disabled PA platform", async () => {
    const token = await signedToken({
      aud: cardResult!.url,
      iss: `${issuer}/disabled-pa`,
    });
    expect((await rawRpc(cardResult!.url, token, {})).status).toBe(401);
  });

  it("rejects an unknown platform issuer", async () => {
    const token = await signedToken({
      aud: cardResult!.url,
      iss: `${issuer}/not-registered`,
    });
    expect((await rawRpc(cardResult!.url, token, {})).status).toBe(401);
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

  it("rejects a customer that has A2A disabled", async () => {
    const url = `${providerUrl}/a2a/${disabledSlug}`;
    const token = await signedToken({ aud: url });
    expect((await rawRpc(url, token, {})).status).toBe(401);
  });

  it("rejects replayed JWT IDs", async () => {
    const token = await signedToken({ aud: cardResult!.url });
    expect((await rawRpc(cardResult!.url, token, {})).status).toBe(200);
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

  it("lists the rescheduled task in the admin console", async () => {
    if (!rescheduleTaskId) throw new Error("Reschedule task was not created");
    const basic = Buffer.from(`${username}:${password}`).toString("base64");
    const admin = await fetch(`${providerUrl}/admin/conversations?channel=pa&pa_platform=demo-pa`, {
      headers: { Authorization: `Basic ${basic}` },
    });
    expect(admin.status).toBe(200);
    expect(await admin.text()).toContain(rescheduleTaskId);
  });

  it("enforces the SendMessage burst limit", async () => {
    const acmeUrl = cardResult!.url;
    const burstClient = client(`e2e-burst-${crypto.randomUUID()}`);
    const burst = await Promise.all(
      Array.from({ length: 40 }, async (_, index) =>
        fetch(acmeUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "A2A-Version": "1.0",
            Authorization: `Bearer ${await burstClient.options.signer.sign({
              sub: burstClient.options.userId,
              aud: acmeUrl,
            })}`,
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: index,
            method: "SendMessage",
            params: {
              message: {
                messageId: crypto.randomUUID(),
                role: "ROLE_USER",
                parts: [{ text: `burst ${index}` }],
              },
            },
          }),
        }),
      ),
    );
    expect(burst.some((result) => result.status === 429)).toBe(true);
  }, 120_000);
});

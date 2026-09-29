import { generateKeyPair, importJWK, SignJWT, type JWK } from "jose";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
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
const providerUrl = process.env.PROVIDER_URL ?? "http://localhost:3000";
const slug = process.env.CUSTOMER_SLUG ?? "";
const disabledSlug = process.env.DISABLED_CUSTOMER_SLUG ?? "";
const issuer = process.env.PA_ISSUER ?? "";
const privateJwk = process.env.PA_PRIVATE_JWK ?? "";
const username = process.env.ADMIN_USER ?? "";
const password = process.env.ADMIN_PASSWORD ?? "";
const jwk = privateJwk ? (JSON.parse(privateJwk) as JWK & { kid: string }) : undefined;

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

describe.sequential("Personal Agent Protocol full E2E", () => {
  it("passes provider, auth, task, admin, and burst scenarios", async () => {
    expect(slug, "CUSTOMER_SLUG must be set").toBeTruthy();
    expect(issuer, "PA_ISSUER must be set").toBeTruthy();
    expect(jwk, "PA_PRIVATE_JWK must be set").toBeTruthy();
    const cardResult = await discoverAgent(providerUrl, slug);
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
    if (disabledSlug) {
      const hiddenCard = await fetch(
        `${providerUrl}/a2a/${encodeURIComponent(disabledSlug)}/.well-known/agent-card.json`,
      );
      expect(hiddenCard.status).toBe(404);
    }

    const makeClient = (userId: string) =>
      new A2AClient({
        url: cardResult.url,
        signer: createPlatformSigner({ privateJwk: jwk!, issuer }),
        userId,
      });
    const jane = makeClient(`e2e-jane-${crypto.randomUUID()}`);
    const faq = await jane.sendMessage("What are your hours?");
    expect(faq.task.status.state).toBe("TASK_STATE_COMPLETED");
    expect(faq.task.status.message?.parts[0]).toMatchObject({
      text: expect.stringContaining("Monday through Friday"),
    });

    const rescheduleClient = makeClient(`e2e-reschedule-${crypto.randomUUID()}`);
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

    const differentCaller = makeClient(`e2e-other-${crypto.randomUUID()}`);
    await expect(differentCaller.getTask(reschedule.task.id)).rejects.toMatchObject({
      code: -32001,
    });
    const otherTasks = await differentCaller.listTasks();
    expect(otherTasks.tasks.some((task) => task.id === reschedule.task.id)).toBe(false);
    await expect(rescheduleClient.cancelTask(reschedule.task.id)).rejects.toMatchObject({
      code: -32002,
    });

    const acmeUrl = cardResult.url;
    const audience = acmeUrl;
    const unauthorized = await rawRpc(acmeUrl, undefined, {});
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get("www-authenticate")).toBe('Bearer realm="a2a"');
    expect(await unauthorized.json()).toMatchObject({
      error: { code: -32000, message: "Unauthorized" },
    });

    const wrongAud = await signedToken({ aud: `${providerUrl}/a2a/${disabledSlug || "wrong"}` });
    expect((await rawRpc(acmeUrl, wrongAud, {})).status).toBe(401);
    const current = Math.floor(Date.now() / 1000);
    const expired = await signedToken({ aud: audience, iat: current - 500, exp: current - 100 });
    expect((await rawRpc(acmeUrl, expired, {})).status).toBe(401);
    const tooLong = await signedToken({ aud: audience, iat: current, exp: current + 301 });
    expect((await rawRpc(acmeUrl, tooLong, {})).status).toBe(401);
    const disabled = await signedToken({ aud: audience, iss: `${issuer}/disabled-pa` });
    expect((await rawRpc(acmeUrl, disabled, {})).status).toBe(401);
    const unknownIssuer = await signedToken({ aud: audience, iss: `${issuer}/not-registered` });
    expect((await rawRpc(acmeUrl, unknownIssuer, {})).status).toBe(401);

    const { privateKey: wrongPrivate } = await generateKeyPair("ES256");
    const badSignature = await signedToken({ aud: audience, signKey: wrongPrivate, kid: jwk!.kid });
    expect((await rawRpc(acmeUrl, badSignature, {})).status).toBe(401);

    if (disabledSlug) {
      const disabledCustomerAudience = `${providerUrl}/a2a/${disabledSlug}`;
      const disabledCustomerToken = await signedToken({ aud: disabledCustomerAudience });
      const blocked = await rawRpc(disabledCustomerAudience, disabledCustomerToken, {});
      expect(blocked.status).toBe(401);
    }
    const replayToken = await signedToken({ aud: audience });
    expect((await rawRpc(acmeUrl, replayToken, {})).status).toBe(200);
    expect((await rawRpc(acmeUrl, replayToken, {})).status).toBe(401);
    const versionToken = await signedToken({ aud: audience });
    const versionResponse = await fetch(acmeUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${versionToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ListTasks", params: {} }),
    });
    expect((await versionResponse.json()).error.code).toBe(-32009);

    const basic = Buffer.from(`${username}:${password}`).toString("base64");
    const admin = await fetch(`${providerUrl}/admin/conversations?channel=pa&pa_platform=demo-pa`, {
      headers: { Authorization: `Basic ${basic}` },
    });
    expect(admin.status).toBe(200);
    expect(await admin.text()).toContain(reschedule.task.id);

    const burstClient = makeClient(`e2e-burst-${crypto.randomUUID()}`);
    const burst = await Promise.all(
      Array.from({ length: 40 }, async (_, index) =>
        fetch(acmeUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "A2A-Version": "1.0",
            Authorization: `Bearer ${await burstClient.options.signer.sign({ sub: burstClient.options.userId, aud: acmeUrl })}`,
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

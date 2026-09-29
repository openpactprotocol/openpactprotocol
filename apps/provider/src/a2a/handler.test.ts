import {
  generateKeyPair,
  calculateJwkThumbprint,
  exportJWK,
  SignJWT,
  createLocalJWKSet,
} from "jose";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createA2AHandler } from "./handler.js";
import { seedDatabase } from "../db/seed.js";
import type { Db } from "../db/client.js";
import * as schema from "../db/schema.js";
import { agentPlatforms, customerPlatforms, customers } from "../db/schema.js";

const issuer = "http://localhost:3002";
const origin = "http://localhost:3000";
let handler: ReturnType<typeof createA2AHandler>;
let client: PGlite;
let slugs: { acmeSlug: string; globexSlug: string };
let keyPair: Awaited<ReturnType<typeof generateKeyPair>>;
let kid: string;
let publicJwk: Awaited<ReturnType<typeof exportJWK>>;
let testDb: Db;

async function token(
  input: {
    sub?: string;
    issuer?: string;
    audience?: string;
    iat?: number;
    exp?: number;
    jti?: string;
    key?: CryptoKey;
  } = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ sub: input.sub ?? "user-1" })
    .setProtectedHeader({ alg: "ES256", kid, typ: "JWT" })
    .setIssuer(input.issuer ?? issuer)
    .setAudience(input.audience ?? `${origin}/a2a/${slugs.acmeSlug}`)
    .setIssuedAt(input.iat ?? now)
    .setExpirationTime(input.exp ?? now + 120)
    .setJti(input.jti ?? crypto.randomUUID())
    .sign(input.key ?? keyPair.privateKey);
}

async function rpc(
  slug: string,
  method: string,
  params: unknown,
  options: { token?: string; version?: string | null } = {},
): Promise<{ response: Response; body: Record<string, unknown> }> {
  const jwt = options.token ?? (await token());
  const response = await handler(
    new Request(`${origin}/a2a/${slug}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        ...(options.version === undefined
          ? { "A2A-Version": "1.0" }
          : options.version === null
            ? {}
            : { "A2A-Version": options.version }),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }),
    slug,
  );
  return { response, body: (await response.json()) as Record<string, unknown> };
}

describe("A2A handler", () => {
  beforeAll(async () => {
    keyPair = await generateKeyPair("ES256", { extractable: true });
    publicJwk = await exportJWK(keyPair.publicKey);
    kid = await calculateJwkThumbprint(publicJwk, "sha256");
    publicJwk.kid = kid;
    publicJwk.alg = "ES256";
    publicJwk.use = "sig";
    client = new PGlite();
    const database = drizzle(client, { schema });
    await migrate(database, {
      migrationsFolder: new URL("../../drizzle", import.meta.url).pathname,
    });
    testDb = database as unknown as Db;
    slugs = await seedDatabase(testDb, issuer);
    const localJwks = createLocalJWKSet({ keys: [publicJwk] });
    handler = createA2AHandler({
      db: testDb,
      getJwks: () => localJwks,
      config: { sendMessageLimitPerMinute: 100 },
    });
  });

  it("authenticates, checks protocol version, and scopes task reads to the PA user", async () => {
    const faq = await rpc(slugs.acmeSlug, "SendMessage", {
      message: {
        messageId: crypto.randomUUID(),
        role: "ROLE_USER",
        parts: [{ text: "What are your hours?" }],
      },
    });
    expect(faq.body).toMatchObject({
      result: { task: { status: { state: "TASK_STATE_COMPLETED" } } },
    });
    const taskId = (faq.body.result as { task: { id: string } }).task.id;
    const secondTask = await rpc(slugs.acmeSlug, "SendMessage", {
      message: {
        messageId: crypto.randomUUID(),
        role: "ROLE_USER",
        parts: [{ text: "Where can I park?" }],
      },
    });
    expect(secondTask.body).toHaveProperty("result.task");
    const firstPage = await rpc(slugs.acmeSlug, "ListTasks", { pageSize: 1 });
    const firstPageResult = firstPage.body.result as {
      tasks: unknown[];
      nextPageToken: string;
      totalSize: number;
    };
    expect(firstPageResult.tasks).toHaveLength(1);
    expect(firstPageResult.totalSize).toBe(2);
    expect(firstPageResult.nextPageToken).not.toBe("");
    const nextPage = await rpc(slugs.acmeSlug, "ListTasks", {
      pageSize: 1,
      pageToken: firstPageResult.nextPageToken,
      includeArtifacts: true,
      historyLength: 0,
    });
    expect(nextPage.body).toMatchObject({ result: { tasks: [{ history: [], artifacts: [] }] } });

    const noAuth = await handler(
      new Request(`${origin}/a2a/${slugs.acmeSlug}`, { method: "POST", body: "{}" }),
      slugs.acmeSlug,
    );
    expect(noAuth.status).toBe(401);
    expect(noAuth.headers.get("www-authenticate")).toBe('Bearer realm="a2a"');

    const oldVersion = await rpc(slugs.acmeSlug, "ListTasks", {}, { version: "0.3" });
    expect(oldVersion.body).toMatchObject({ error: { code: -32009 } });
    const otherUser = await rpc(
      slugs.acmeSlug,
      "GetTask",
      { id: taskId },
      { token: await token({ sub: "other-user" }) },
    );
    expect(otherUser.body).toMatchObject({ error: { code: -32001 } });
    const listed = await rpc(
      slugs.acmeSlug,
      "ListTasks",
      {},
      { token: await token({ sub: "other-user" }) },
    );
    expect(listed.body).toMatchObject({ result: { tasks: [] } });
  });

  it("rejects malformed requests, unsupported operations, invalid audience, disabled platforms, and replay", async () => {
    const badVersion = await rpc(slugs.acmeSlug, "ListTasks", {}, { version: null });
    expect(badVersion.body).toMatchObject({ error: { code: -32009 } });
    const wrongAud = await rpc(
      slugs.acmeSlug,
      "ListTasks",
      {},
      {
        token: await token({ audience: `${origin}/a2a/${slugs.globexSlug}` }),
      },
    );
    expect(wrongAud.response.status).toBe(401);
    const otherKey = await generateKeyPair("ES256", { extractable: true });
    const badSignature = await rpc(
      slugs.acmeSlug,
      "ListTasks",
      {},
      { token: await token({ key: otherKey.privateKey }) },
    );
    expect(badSignature.response.status).toBe(401);
    const unknownIssuer = await rpc(
      slugs.acmeSlug,
      "ListTasks",
      {},
      {
        token: await token({ issuer: `${issuer}/unknown` }),
      },
    );
    expect(unknownIssuer.response.status).toBe(401);
    const disabled = await rpc(
      slugs.acmeSlug,
      "ListTasks",
      {},
      {
        token: await token({ issuer: `${issuer}/disabled-pa` }),
      },
    );
    expect(disabled.response.status).toBe(401);
    const disabledCustomer = await rpc(
      slugs.globexSlug,
      "ListTasks",
      {},
      {
        token: await token({ audience: `${origin}/a2a/${slugs.globexSlug}` }),
      },
    );
    expect(disabledCustomer.response.status).toBe(401);
    const [platform] = await testDb
      .select()
      .from(agentPlatforms)
      .where(eq(agentPlatforms.name, "demo-pa"));
    const [customer] = await testDb
      .select()
      .from(customers)
      .where(eq(customers.slug, slugs.acmeSlug));
    if (!platform || !customer) throw new Error("Seeded platform/customer missing");
    await testDb
      .update(customerPlatforms)
      .set({ allowed: false })
      .where(
        and(
          eq(customerPlatforms.platformId, platform.id),
          eq(customerPlatforms.customerId, customer.id),
        ),
      );
    const notAllowed = await rpc(slugs.acmeSlug, "ListTasks", {});
    expect(notAllowed.response.status).toBe(401);
    await testDb
      .update(customerPlatforms)
      .set({ allowed: true })
      .where(
        and(
          eq(customerPlatforms.platformId, platform.id),
          eq(customerPlatforms.customerId, customer.id),
        ),
      );
    const expired = await rpc(
      slugs.acmeSlug,
      "ListTasks",
      {},
      {
        token: await token({
          iat: Math.floor(Date.now() / 1000) - 600,
          exp: Math.floor(Date.now() / 1000) - 400,
        }),
      },
    );
    expect(expired.response.status).toBe(401);
    const longLifetime = await rpc(
      slugs.acmeSlug,
      "ListTasks",
      {},
      {
        token: await token({ exp: Math.floor(Date.now() / 1000) + 301 }),
      },
    );
    expect(longLifetime.response.status).toBe(401);

    const body = await rpc(slugs.acmeSlug, "NoSuchMethod", {});
    expect(body.body).toMatchObject({ error: { code: -32601 } });
    const badParams = await rpc(slugs.acmeSlug, "GetTask", {});
    expect(badParams.body).toMatchObject({ error: { code: -32602 } });
    const cancel = await rpc(slugs.acmeSlug, "CancelTask", { id: crypto.randomUUID() });
    expect(cancel.body).toMatchObject({ error: { code: -32002 } });
    const unsupported = await rpc(slugs.acmeSlug, "SendStreamingMessage", {});
    expect(unsupported.body).toMatchObject({ error: { code: -32004 } });
    const unsupportedPush = await rpc(slugs.acmeSlug, "CreateTaskPushNotificationConfig", {});
    expect(unsupportedPush.body).toMatchObject({ error: { code: -32004 } });
    const extended = await rpc(slugs.acmeSlug, "GetExtendedAgentCard", {});
    expect(extended.body).toMatchObject({ error: { code: -32007 } });

    const replay = await token();
    await rpc(slugs.acmeSlug, "ListTasks", {}, { token: replay });
    const repeated = await rpc(slugs.acmeSlug, "ListTasks", {}, { token: replay });
    expect(repeated.response.status).toBe(401);
  });

  it("routes verification and unavailable billing to the safe channel", async () => {
    const lookup = await rpc(slugs.acmeSlug, "SendMessage", {
      message: {
        messageId: crypto.randomUUID(),
        role: "ROLE_USER",
        parts: [{ text: "Look up my appointment" }],
      },
    });
    expect(lookup.body).toMatchObject({
      result: { task: { status: { state: "TASK_STATE_INPUT_REQUIRED" } } },
    });
    const taskId = (lookup.body.result as { task: { id: string } }).task.id;
    const verified = await rpc(slugs.acmeSlug, "SendMessage", {
      message: {
        messageId: crypto.randomUUID(),
        taskId,
        role: "ROLE_USER",
        parts: [{ text: "jane.doe@example.com 1990-04-12" }],
      },
    });
    expect(verified.body).toMatchObject({
      result: { task: { status: { state: "TASK_STATE_COMPLETED" } } },
    });
    const rescheduleStart = await rpc(slugs.acmeSlug, "SendMessage", {
      message: {
        messageId: crypto.randomUUID(),
        role: "ROLE_USER",
        parts: [{ text: "I need to reschedule my appointment" }],
      },
    });
    const rescheduleTaskId = (rescheduleStart.body.result as { task: { id: string } }).task.id;
    const failedVerification = await rpc(slugs.acmeSlug, "SendMessage", {
      message: {
        messageId: crypto.randomUUID(),
        taskId: rescheduleTaskId,
        role: "ROLE_USER",
        parts: [{ text: "not-jane@example.com 1990-04-12" }],
      },
    });
    expect(JSON.stringify(failedVerification.body)).toContain("couldn't verify");
    const rescheduleVerified = await rpc(slugs.acmeSlug, "SendMessage", {
      message: {
        messageId: crypto.randomUUID(),
        taskId: rescheduleTaskId,
        role: "ROLE_USER",
        parts: [{ text: "jane.doe@example.com 1990-04-12" }],
      },
    });
    expect(JSON.stringify(rescheduleVerified.body)).toContain("What new time");
    const futureTime = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 16)
      .replace("T", " ");
    const rescheduled = await rpc(slugs.acmeSlug, "SendMessage", {
      message: {
        messageId: crypto.randomUUID(),
        taskId: rescheduleTaskId,
        role: "ROLE_USER",
        parts: [{ text: futureTime }],
      },
    });
    expect(rescheduled.body).toMatchObject({
      result: { task: { status: { state: "TASK_STATE_COMPLETED" } } },
    });
    const billing = await rpc(slugs.acmeSlug, "SendMessage", {
      message: {
        messageId: crypto.randomUUID(),
        role: "ROLE_USER",
        parts: [{ text: "I dispute this charge" }],
      },
    });
    expect(billing.body).toMatchObject({
      result: {
        task: {
          status: {
            state: "TASK_STATE_INPUT_REQUIRED",
            message: { parts: [{ text: expect.stringContaining("human") }] },
          },
        },
      },
    });
  });

  it("rejects A2A requests for the disabled customer", async () => {
    const response = await handler(
      new Request(`${origin}/a2a/${slugs.globexSlug}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${await token({ audience: `${origin}/a2a/${slugs.globexSlug}` })}`,
          "A2A-Version": "1.0",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ListTasks", params: {} }),
      }),
      slugs.globexSlug,
    );
    expect(response.status).toBe(401);
  });

  it("enforces the per-platform fixed-window send-message limit", async () => {
    const limitedHandler = createA2AHandler({
      db: testDb,
      getJwks: () => createLocalJWKSet({ keys: [publicJwk] }),
      now: () => new Date("2099-02-01T12:34:15.000Z"),
      config: { sendMessageLimitPerMinute: 1 },
    });
    const invoke = async (messageId: string) => {
      const response = await limitedHandler(
        new Request(`${origin}/a2a/${slugs.acmeSlug}`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${await token()}`,
            "A2A-Version": "1.0",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "SendMessage",
            params: {
              message: { messageId, role: "ROLE_USER", parts: [{ text: "What are your hours?" }] },
            },
          }),
        }),
        slugs.acmeSlug,
      );
      return response;
    };
    const first = await invoke(crypto.randomUUID());
    const second = await invoke(crypto.randomUUID());
    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
    expect(second.headers.get("retry-after")).toBe("45");
  });

  afterAll(async () => {
    await client?.close();
  });
});

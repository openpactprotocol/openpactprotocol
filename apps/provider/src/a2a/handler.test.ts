import {
  calculateJwkThumbprint,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
} from "jose";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedDatabase } from "../db/seed.js";
import type { Db } from "../db/client.js";
import * as schema from "../db/schema.js";
import { agentPlatforms, conversations, customers } from "../db/schema.js";
import { buildAgentCard } from "./agentCard.js";
import { createA2AHandler } from "./handler.js";

const issuer = "http://localhost:3002";
const origin = "http://localhost:3000";

let handler: ReturnType<typeof createA2AHandler>;
let client: PGlite;
let testDb: Db;
let slugs: { acmeSlug: string; globexSlug: string };
let keyPair: Awaited<ReturnType<typeof generateKeyPair>>;
let kid: string;
let publicJwk: Awaited<ReturnType<typeof exportJWK>>;

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

async function raw(
  slug: string,
  body: string,
  options: { token?: string; version?: string | null } = {},
): Promise<{ response: Response; body: Record<string, unknown> }> {
  const response = await handler(
    new Request(`${origin}/a2a/${slug}`, {
      method: "POST",
      headers: {
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        ...(options.version === null ? {} : { "A2A-Version": options.version ?? "1.0" }),
        "Content-Type": "application/json",
      },
      body,
    }),
    slug,
  );
  return { response, body: (await response.json()) as Record<string, unknown> };
}

async function rpc(
  slug: string,
  method: string,
  params: unknown,
  options: {
    token?: string;
    version?: string | null;
    sub?: string;
  } = {},
): Promise<{ response: Response; body: Record<string, unknown> }> {
  const jwt = options.token ?? (await token({ sub: options.sub }));
  return raw(slug, JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), {
    token: jwt,
    version: options.version,
  });
}

function taskFrom(body: Record<string, unknown>): {
  id: string;
  contextId?: string;
  status: { state: string };
  history: { role: string; contextId?: string }[];
  metadata?: unknown;
} {
  const task = (body.result as { task?: unknown } | undefined)?.task;
  if (!task || typeof task !== "object") throw new Error("Task response is missing");
  return task as {
    id: string;
    contextId?: string;
    status: { state: string };
    history: { role: string; contextId?: string }[];
    metadata?: unknown;
  };
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
    handler = createA2AHandler({ db: testDb, getJwks: () => localJwks });
  });

  it("seeds UUIDv7 customer IDs and derives slugs from the IDs", async () => {
    const customer = await testDb.query.customers.findFirst({
      where: eq(customers.name, "Acme Health"),
    });
    if (!customer) throw new Error("Seeded Acme customer missing");
    expect(customer.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(customer.slug).toBe(`${customer.id.slice(-7)}_acme_health`);
  });

  it("authenticates callers and scopes task reads by PA user", async () => {
    const faq = await rpc(slugs.acmeSlug, "SendMessage", {
      message: {
        messageId: crypto.randomUUID(),
        role: "ROLE_USER",
        parts: [{ text: "What are your hours?" }],
      },
    });
    const task = taskFrom(faq.body);
    expect(task.status.state).toBe("TASK_STATE_COMPLETED");
    expect(task).not.toHaveProperty("contextId");
    expect(task.history.every((message) => !("contextId" in message))).toBe(true);
    expect(task).not.toHaveProperty("metadata");

    const fetched = await rpc(slugs.acmeSlug, "GetTask", { id: task.id });
    expect(fetched.body).toHaveProperty("result.id", task.id);
    expect(fetched.body.result).not.toHaveProperty("contextId");
    expect(fetched.body.result).not.toHaveProperty("metadata");

    const otherUser = await rpc(
      slugs.acmeSlug,
      "GetTask",
      { id: task.id },
      { token: await token({ sub: "other-user" }) },
    );
    expect(otherUser.body).toMatchObject({ error: { code: -32001 } });
    const otherUserTasks = await rpc(
      slugs.acmeSlug,
      "ListTasks",
      {},
      { token: await token({ sub: "other-user" }) },
    );
    expect(otherUserTasks.body).toMatchObject({ result: { tasks: [] } });
  });

  it("rejects missing, invalid, expired, replayed, or disabled platform credentials", async () => {
    const noAuth = await raw(
      slugs.acmeSlug,
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ListTasks", params: {} }),
    );
    expect(noAuth.response.status).toBe(401);
    expect(noAuth.response.headers.get("www-authenticate")).toBe('Bearer realm="a2a"');
    expect(noAuth.body).toMatchObject({ error: { code: -32000, message: "Unauthorized" } });

    const wrongAudience = await rpc(
      slugs.acmeSlug,
      "ListTasks",
      {},
      { token: await token({ audience: `${origin}/a2a/${slugs.globexSlug}` }) },
    );
    expect(wrongAudience.response.status).toBe(401);

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
      { token: await token({ issuer: `${issuer}/unknown` }) },
    );
    expect(unknownIssuer.response.status).toBe(401);

    const disabledPlatform = await rpc(
      slugs.acmeSlug,
      "ListTasks",
      {},
      { token: await token({ issuer: `${issuer}/disabled-pa` }) },
    );
    expect(disabledPlatform.response.status).toBe(401);

    const now = Math.floor(Date.now() / 1000);
    const expired = await rpc(
      slugs.acmeSlug,
      "ListTasks",
      {},
      { token: await token({ iat: now - 200, exp: now - 100 }) },
    );
    expect(expired.response.status).toBe(401);

    const longLifetime = await rpc(
      slugs.acmeSlug,
      "ListTasks",
      {},
      { token: await token({ iat: now, exp: now + 301 }) },
    );
    expect(longLifetime.response.status).toBe(401);

    const futureIssued = await rpc(
      slugs.acmeSlug,
      "ListTasks",
      {},
      { token: await token({ iat: now + 31, exp: now + 151 }) },
    );
    expect(futureIssued.response.status).toBe(401);

    const unknownCustomer = await rpc(
      "missing-customer",
      "ListTasks",
      {},
      { token: await token({ audience: `${origin}/a2a/missing-customer` }) },
    );
    expect(unknownCustomer.response.status).toBe(401);

    const replayToken = await token();
    expect(
      (await rpc(slugs.acmeSlug, "ListTasks", {}, { token: replayToken })).response.status,
    ).toBe(200);
    expect(
      (await rpc(slugs.acmeSlug, "ListTasks", {}, { token: replayToken })).response.status,
    ).toBe(401);

    const [demoPlatform] = await testDb
      .select()
      .from(agentPlatforms)
      .where(eq(agentPlatforms.name, "demo-pa"));
    if (!demoPlatform) throw new Error("Seeded demo platform missing");
    await testDb
      .update(agentPlatforms)
      .set({ enabled: false })
      .where(eq(agentPlatforms.id, demoPlatform.id));
    try {
      const disabledDemo = await rpc(slugs.acmeSlug, "ListTasks", {});
      expect(disabledDemo.response.status).toBe(401);
    } finally {
      await testDb
        .update(agentPlatforms)
        .set({ enabled: true })
        .where(eq(agentPlatforms.id, demoPlatform.id));
    }
  });

  it("validates JSON-RPC, protocol version, content type, and unsupported methods", async () => {
    const parseError = await raw(slugs.acmeSlug, "{", { token: await token() });
    expect(parseError.body).toMatchObject({ error: { code: -32700 } });

    const invalidRequest = await raw(slugs.acmeSlug, "[]", { token: await token() });
    expect(invalidRequest.body).toMatchObject({ error: { code: -32600 } });

    const missingVersion = await rpc(slugs.acmeSlug, "ListTasks", {}, { version: null });
    expect(missingVersion.body).toMatchObject({ error: { code: -32009 } });

    const unknownMethod = await rpc(slugs.acmeSlug, "NoSuchMethod", {});
    expect(unknownMethod.body).toMatchObject({ error: { code: -32601 } });

    const invalidParams = await rpc(slugs.acmeSlug, "GetTask", {});
    expect(invalidParams.body).toMatchObject({ error: { code: -32602 } });

    const streaming = await rpc(slugs.acmeSlug, "SendStreamingMessage", {});
    expect(streaming.body).toMatchObject({ error: { code: -32004 } });
    const subscribe = await rpc(slugs.acmeSlug, "SubscribeToTask", {});
    expect(subscribe.body).toMatchObject({ error: { code: -32004 } });
    const extendedCard = await rpc(slugs.acmeSlug, "GetExtendedAgentCard", {});
    expect(extendedCard.body).toMatchObject({ error: { code: -32007 } });
    const cancel = await rpc(slugs.acmeSlug, "CancelTask", { id: crypto.randomUUID() });
    expect(cancel.body).toMatchObject({ error: { code: -32002 } });

    const nonText = await rpc(slugs.acmeSlug, "SendMessage", {
      message: {
        messageId: crypto.randomUUID(),
        role: "ROLE_USER",
        parts: [{ raw: "aGVsbG8=" }],
      },
    });
    expect(nonText.body).toMatchObject({ error: { code: -32005 } });

    const returnImmediately = await rpc(slugs.acmeSlug, "SendMessage", {
      message: {
        messageId: crypto.randomUUID(),
        role: "ROLE_USER",
        parts: [{ text: "hours" }],
      },
      configuration: { returnImmediately: true },
    });
    expect(returnImmediately.body).toMatchObject({ error: { code: -32004 } });
  });

  it("builds the static FAQ agent card", async () => {
    const customer = await testDb.query.customers.findFirst({
      where: eq(customers.slug, slugs.acmeSlug),
    });
    if (!customer) throw new Error("Seeded Acme customer missing");
    const card = buildAgentCard(customer, `${origin}/`);
    expect(card.supportedInterfaces[0]?.url).toBe(`${origin}/a2a/${slugs.acmeSlug}`);
    expect(card.capabilities).toMatchObject({ streaming: false, pushNotifications: false });
    expect(card.skills).toEqual([
      {
        id: "faq",
        name: "FAQ",
        description: "Answer questions about hours, location, parking, and insurance.",
        tags: ["faq"],
      },
    ]);
  });

  it("supports multi-turn FAQ and preserves message history without Task metadata", async () => {
    const sub = `faq-${crypto.randomUUID()}`;
    const start = await rpc(
      slugs.acmeSlug,
      "SendMessage",
      {
        message: {
          messageId: crypto.randomUUID(),
          role: "ROLE_USER",
          parts: [{ text: "Can you help me?" }],
        },
      },
      { sub },
    );
    const startedTask = taskFrom(start.body);
    expect(startedTask.status.state).toBe("TASK_STATE_INPUT_REQUIRED");
    expect(start.body).toMatchObject({
      result: {
        task: {
          status: {
            message: {
              parts: [
                {
                  text: "Which would you like to know about: hours, location, parking, or insurance?",
                },
              ],
            },
          },
        },
      },
    });

    const answer = await rpc(
      slugs.acmeSlug,
      "SendMessage",
      {
        message: {
          messageId: crypto.randomUUID(),
          taskId: startedTask.id,
          role: "ROLE_USER",
          parts: [{ text: "hours" }],
        },
      },
      { sub },
    );
    const answeredTask = taskFrom(answer.body);
    expect(answeredTask.id).toBe(startedTask.id);
    expect(answeredTask.status.state).toBe("TASK_STATE_COMPLETED");
    expect(answeredTask.history).toHaveLength(4);
    expect(answeredTask).not.toHaveProperty("metadata");

    const savedConversation = await testDb.query.conversations.findFirst({
      where: eq(conversations.id, answeredTask.id),
    });
    expect(savedConversation?.metadata.flow).toMatchObject({ awaitingFaqTopic: false });

    const noHistory = await rpc(
      slugs.acmeSlug,
      "GetTask",
      { id: answeredTask.id, historyLength: 0 },
      { sub },
    );
    expect(noHistory.body).toMatchObject({ result: { history: [] } });
    const oneHistoryMessage = await rpc(
      slugs.acmeSlug,
      "GetTask",
      { id: answeredTask.id, historyLength: 1 },
      { sub },
    );
    expect((oneHistoryMessage.body.result as { history: unknown[] }).history).toHaveLength(1);
    const sendHistoryLength = await rpc(
      slugs.acmeSlug,
      "SendMessage",
      {
        message: {
          messageId: crypto.randomUUID(),
          role: "ROLE_USER",
          parts: [{ text: "Where is the clinic?" }],
        },
        configuration: { historyLength: 1 },
      },
      { sub },
    );
    expect(taskFrom(sendHistoryLength.body).history).toHaveLength(1);

    const completedTaskSend = await rpc(
      slugs.acmeSlug,
      "SendMessage",
      {
        message: {
          messageId: crypto.randomUUID(),
          taskId: answeredTask.id,
          role: "ROLE_USER",
          parts: [{ text: "parking" }],
        },
      },
      { sub },
    );
    expect(completedTaskSend.body).toMatchObject({ error: { code: -32004 } });
  });

  it("stores, echoes, and filters by an optional context ID", async () => {
    const sub = `context-${crypto.randomUUID()}`;
    const contextId = `ctx-${crypto.randomUUID()}`;
    const started = await rpc(
      slugs.acmeSlug,
      "SendMessage",
      {
        message: {
          messageId: crypto.randomUUID(),
          contextId,
          role: "ROLE_USER",
          parts: [{ text: "Can you help me?" }],
        },
      },
      { sub },
    );
    const startedTask = taskFrom(started.body);
    expect(startedTask.contextId).toBe(contextId);
    expect(startedTask.status.state).toBe("TASK_STATE_INPUT_REQUIRED");

    const continued = await rpc(
      slugs.acmeSlug,
      "SendMessage",
      {
        message: {
          messageId: crypto.randomUUID(),
          taskId: startedTask.id,
          role: "ROLE_USER",
          parts: [{ text: "hours" }],
        },
      },
      { sub },
    );
    const task = taskFrom(continued.body);
    expect(task.id).toBe(startedTask.id);
    expect(task.contextId).toBe(contextId);
    expect(task.status.state).toBe("TASK_STATE_COMPLETED");
    expect(task.history.every((message) => message.contextId === contextId)).toBe(true);

    const savedConversation = await testDb.query.conversations.findFirst({
      where: eq(conversations.id, task.id),
    });
    expect(savedConversation?.metadata.contextId).toBe(contextId);

    const fetched = await rpc(slugs.acmeSlug, "GetTask", { id: task.id }, { sub });
    expect(fetched.body).toHaveProperty("result.contextId", contextId);
    expect(
      (fetched.body.result as { history: { contextId?: string }[] }).history.every(
        (message) => message.contextId === contextId,
      ),
    ).toBe(true);

    const listed = await rpc(slugs.acmeSlug, "ListTasks", { contextId }, { sub });
    expect(listed.body).toMatchObject({ result: { tasks: [{ id: task.id }], totalSize: 1 } });
    const filteredOut = await rpc(
      slugs.acmeSlug,
      "ListTasks",
      { contextId: `${contextId}-other` },
      { sub },
    );
    expect(filteredOut.body).toMatchObject({ result: { tasks: [], totalSize: 0 } });
  });

  it("rejects a mismatched context and paginates caller-owned tasks", async () => {
    const sub = `pagination-${crypto.randomUUID()}`;
    const started = await rpc(
      slugs.acmeSlug,
      "SendMessage",
      {
        message: {
          messageId: crypto.randomUUID(),
          role: "ROLE_USER",
          parts: [{ text: "Can you help?" }],
        },
      },
      { sub },
    );
    const task = taskFrom(started.body);
    const mismatch = await rpc(
      slugs.acmeSlug,
      "SendMessage",
      {
        message: {
          messageId: crypto.randomUUID(),
          taskId: task.id,
          contextId: "unexpected-context",
          role: "ROLE_USER",
          parts: [{ text: "hours" }],
        },
      },
      { sub },
    );
    expect(mismatch.body).toMatchObject({ error: { code: -32602 } });

    for (const text of ["hours", "parking", "insurance"]) {
      await rpc(
        slugs.acmeSlug,
        "SendMessage",
        {
          message: {
            messageId: crypto.randomUUID(),
            role: "ROLE_USER",
            parts: [{ text }],
          },
        },
        { sub },
      );
    }

    const first = await rpc(slugs.acmeSlug, "ListTasks", { pageSize: 1 }, { sub });
    const firstPage = first.body.result as {
      tasks: { id: string }[];
      nextPageToken: string;
      totalSize: number;
    };
    expect(firstPage.tasks).toHaveLength(1);
    expect(firstPage.nextPageToken).not.toBe("");
    expect(firstPage.totalSize).toBe(4);

    const second = await rpc(
      slugs.acmeSlug,
      "ListTasks",
      { pageSize: 1, pageToken: firstPage.nextPageToken },
      { sub },
    );
    const secondPage = second.body.result as { tasks: { id: string }[]; nextPageToken: string };
    expect(secondPage.tasks).toHaveLength(1);
    expect(secondPage.tasks[0]?.id).not.toBe(firstPage.tasks[0]?.id);
    expect(secondPage.nextPageToken).not.toBe("");

    const last = await rpc(
      slugs.acmeSlug,
      "ListTasks",
      { pageSize: 2, pageToken: secondPage.nextPageToken },
      { sub },
    );
    expect(last.body).toMatchObject({
      result: { tasks: [{}, {}], nextPageToken: "", totalSize: 4 },
    });
    const completed = await rpc(
      slugs.acmeSlug,
      "ListTasks",
      { status: "TASK_STATE_COMPLETED" },
      { sub },
    );
    expect(completed.body).toMatchObject({ result: { totalSize: 3 } });
  });

  afterAll(async () => {
    await client?.close();
  });
});

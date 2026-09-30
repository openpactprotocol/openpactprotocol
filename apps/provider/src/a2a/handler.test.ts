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
import { A2A_ERRORS, A2AErrorResponseSchema, TaskSchema, type Task } from "@pap/protocol";
import { seedDatabase } from "../db/seed.js";
import type { Db } from "../db/client.js";
import * as schema from "../db/schema.js";
import { conversations, customers } from "../db/schema.js";
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

async function call(
  slug: string,
  path: string,
  method = "GET",
  body?: unknown,
  options: {
    token?: string | null;
    sub?: string;
    version?: string | null;
    contentType?: string;
  } = {},
): Promise<Response> {
  const jwt =
    options.token === null
      ? undefined
      : (options.token ?? (await token({ sub: options.sub, audience: `${origin}/a2a/${slug}` })));
  const headers = new Headers();
  if (jwt) headers.set("Authorization", `Bearer ${jwt}`);
  if (options.version === undefined) headers.set("A2A-Version", "1.0");
  else if (options.version !== null) headers.set("A2A-Version", options.version);
  if (body !== undefined || options.contentType) {
    headers.set("Content-Type", options.contentType ?? "application/json");
  }
  const routePath = path.replace(/^\/+/, "");
  const request = new Request(`${origin}/a2a/${slug}${routePath ? `/${routePath}` : ""}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
  const pathname = path.split("?")[0]?.replace(/^\/+/, "") ?? "";
  const segments = pathname ? pathname.split("/") : [];
  return handler(request, slug, segments);
}

function sendBody(
  text: string,
  options: { taskId?: string; contextId?: string; historyLength?: number } = {},
) {
  return {
    message: {
      messageId: crypto.randomUUID(),
      ...(options.taskId === undefined ? {} : { taskId: options.taskId }),
      ...(options.contextId === undefined ? {} : { contextId: options.contextId }),
      role: "ROLE_USER",
      parts: [{ text, mediaType: "text/plain" }],
    },
    ...(options.historyLength === undefined
      ? {}
      : { configuration: { historyLength: options.historyLength } }),
  };
}

async function errorResponse(response: Response, reason: keyof typeof A2A_ERRORS): Promise<void> {
  const parsed = A2AErrorResponseSchema.parse(await response.json());
  const expected = A2A_ERRORS[reason];
  expect(response.status).toBe(expected.httpStatus);
  expect(response.headers.get("content-type")).toContain("application/json");
  expect(parsed.error).toMatchObject({
    code: expected.httpStatus,
    status: expected.status,
    details: [{ reason, domain: "a2a-protocol.org" }],
  });
}

async function readTask(response: Response): Promise<Task> {
  return TaskSchema.parse(await response.json());
}

describe("A2A HTTP+JSON handler", () => {
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

  it("serves a public HTTP+JSON Agent Card only for existing customers", async () => {
    const response = await call(slugs.acmeSlug, ".well-known/agent-card.json");
    const card = await response.json();
    expect(response.status).toBe(200);
    expect(card.supportedInterfaces).toEqual([
      {
        url: `${origin}/a2a/${slugs.acmeSlug}`,
        protocolBinding: "HTTP+JSON",
        protocolVersion: "1.0",
      },
    ]);
    expect(card.skills).toEqual([
      {
        id: "faq",
        name: "FAQ",
        description: "Answer questions about hours, location, parking, and insurance.",
        tags: ["faq"],
      },
    ]);
    const unknown = await call(
      "unknown-customer",
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

  it("returns empty 404 responses for unmatched routes and methods before authentication", async () => {
    for (const [method, path] of [
      ["GET", "unknown"],
      ["POST", "unknown"],
      ["DELETE", "message:send"],
      ["PUT", "message:send"],
      ["POST", "tasks"],
      ["GET", "tasks/id/unknown"],
    ]) {
      const response = await call(slugs.acmeSlug, path, method, undefined, { token: null });
      expect(response.status).toBe(404);
      expect(await response.text()).toBe("");
    }
  });

  it("returns bare 401 responses for invalid platform JWTs before checking protocol version", async () => {
    const noAuth = await call(slugs.acmeSlug, "tasks", "GET", undefined, {
      token: null,
      version: null,
    });
    expect(noAuth.status).toBe(401);
    expect(await noAuth.text()).toBe("");
    expect(noAuth.headers.get("www-authenticate")).toBe('Bearer realm="a2a"');

    const wrongAudience = await call(slugs.acmeSlug, "tasks", "GET", undefined, {
      token: await token({ audience: `${origin}/a2a/${slugs.globexSlug}` }),
    });
    expect(wrongAudience.status).toBe(401);
    expect(await wrongAudience.text()).toBe("");

    const otherKey = await generateKeyPair("ES256", { extractable: true });
    const badSignature = await call(slugs.acmeSlug, "tasks", "GET", undefined, {
      token: await token({ key: otherKey.privateKey }),
    });
    expect(badSignature.status).toBe(401);

    const unknownIssuer = await call(slugs.acmeSlug, "tasks", "GET", undefined, {
      token: await token({ issuer: `${issuer}/unknown` }),
    });
    expect(unknownIssuer.status).toBe(401);

    const disabledPlatform = await call(slugs.acmeSlug, "tasks", "GET", undefined, {
      token: await token({ issuer: `${issuer}/disabled-pa` }),
    });
    expect(disabledPlatform.status).toBe(401);

    const now = Math.floor(Date.now() / 1000);
    const expired = await call(slugs.acmeSlug, "tasks", "GET", undefined, {
      token: await token({ iat: now - 200, exp: now - 100 }),
    });
    expect(expired.status).toBe(401);

    const longLifetime = await call(slugs.acmeSlug, "tasks", "GET", undefined, {
      token: await token({ iat: now, exp: now + 301 }),
    });
    expect(longLifetime.status).toBe(401);

    const futureIssued = await call(slugs.acmeSlug, "tasks", "GET", undefined, {
      token: await token({ iat: now + 31, exp: now + 151 }),
    });
    expect(futureIssued.status).toBe(401);

    const unknownCustomer = await call("missing-customer", "tasks", "GET", undefined, {
      token: await token({ audience: `${origin}/a2a/missing-customer` }),
    });
    expect(unknownCustomer.status).toBe(401);

    const replayToken = await token();
    expect(
      (await call(slugs.acmeSlug, "tasks", "GET", undefined, { token: replayToken })).status,
    ).toBe(200);
    const replay = await call(slugs.acmeSlug, "tasks", "GET", undefined, {
      token: replayToken,
    });
    expect(replay.status).toBe(401);
  });

  it("requires A2A-Version 1.0 and validates JSON bodies and content types", async () => {
    const missingVersion = await call(slugs.acmeSlug, "message:send", "POST", sendBody("hours"), {
      version: null,
    });
    await errorResponse(missingVersion, "VERSION_NOT_SUPPORTED");
    const unsupportedVersion = await call(
      slugs.acmeSlug,
      "message:send",
      "POST",
      sendBody("hours"),
      { version: "0.3" },
    );
    await errorResponse(unsupportedVersion, "VERSION_NOT_SUPPORTED");

    const invalidJson = await call(slugs.acmeSlug, "message:send", "POST", "{");
    await errorResponse(invalidJson, "INVALID_ARGUMENT");
    const invalidBody = await call(slugs.acmeSlug, "message:send", "POST", {});
    await errorResponse(invalidBody, "INVALID_ARGUMENT");
    const unsupportedHeader = await call(
      slugs.acmeSlug,
      "message:send",
      "POST",
      sendBody("hours"),
      { contentType: "text/plain" },
    );
    await errorResponse(unsupportedHeader, "CONTENT_TYPE_NOT_SUPPORTED");

    const nonText = await call(slugs.acmeSlug, "message:send", "POST", {
      message: {
        messageId: crypto.randomUUID(),
        role: "ROLE_USER",
        parts: [{ raw: "aGVsbG8=" }],
      },
    });
    await errorResponse(nonText, "CONTENT_TYPE_NOT_SUPPORTED");

    const a2aJson = await call(slugs.acmeSlug, "message:send", "POST", sendBody("hours"), {
      contentType: "application/a2a+json; charset=utf-8",
    });
    expect(a2aJson.status).toBe(200);
    expect(await a2aJson.json()).toHaveProperty("task.status.state", "TASK_STATE_COMPLETED");
  });

  it("maps unexpected request failures to INTERNAL", async () => {
    let nowCalls = 0;
    const failingHandler = createA2AHandler({
      db: testDb,
      getJwks: () => createLocalJWKSet({ keys: [publicJwk] }),
      now: () => {
        nowCalls += 1;
        if (nowCalls > 1) throw new Error("unexpected test failure");
        return new Date();
      },
    });
    const jwt = await token();
    const request = new Request(`${origin}/a2a/${slugs.acmeSlug}/message:send`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        "A2A-Version": "1.0",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(sendBody("hours")),
    });
    await errorResponse(
      await failingHandler(request, slugs.acmeSlug, ["message:send"]),
      "INTERNAL",
    );
  });

  it("returns the HTTP error mappings for unsupported operations and cancellation", async () => {
    const id = crypto.randomUUID();
    await errorResponse(
      await call(slugs.acmeSlug, "message:stream", "POST"),
      "UNSUPPORTED_OPERATION",
    );
    await errorResponse(
      await call(slugs.acmeSlug, "message:send", "POST", {
        ...sendBody("hours"),
        configuration: { returnImmediately: true },
      }),
      "UNSUPPORTED_OPERATION",
    );
    await errorResponse(
      await call(slugs.acmeSlug, `tasks/${id}:subscribe`, "GET"),
      "UNSUPPORTED_OPERATION",
    );
    await errorResponse(
      await call(slugs.acmeSlug, `tasks/${id}:subscribe`, "POST"),
      "UNSUPPORTED_OPERATION",
    );
    for (const [method, path] of [
      ["GET", `tasks/${id}/pushNotificationConfigs`],
      ["POST", `tasks/${id}/pushNotificationConfigs`],
      ["DELETE", `tasks/${id}/pushNotificationConfigs/config-1`],
      ["GET", `tasks/${id}/pushNotificationConfigs/config-1`],
    ]) {
      await errorResponse(await call(slugs.acmeSlug, path, method), "UNSUPPORTED_OPERATION");
    }
    await errorResponse(
      await call(slugs.acmeSlug, "extendedAgentCard", "GET"),
      "EXTENDED_AGENT_CARD_NOT_CONFIGURED",
    );
    await errorResponse(
      await call(slugs.acmeSlug, `tasks/${id}:cancel`, "POST", { id }),
      "TASK_NOT_FOUND",
    );
  });

  it("answers FAQs, preserves multi-turn history, and applies history limits", async () => {
    const startedResponse = await call(
      slugs.acmeSlug,
      "message:send",
      "POST",
      sendBody("Can you help me?", { historyLength: 1 }),
      { sub: "multi-turn-user" },
    );
    const startedJson = (await startedResponse.json()) as { task: Task };
    const started = TaskSchema.parse(startedJson.task);
    expect(started.status.state).toBe("TASK_STATE_INPUT_REQUIRED");
    expect(started).not.toHaveProperty("contextId");
    expect(started.history).toHaveLength(1);
    expect(started.status.message?.parts[0]).toMatchObject({
      text: "Which would you like to know about: hours, location, parking, or insurance?",
    });

    const completedResponse = await call(
      slugs.acmeSlug,
      "message:send",
      "POST",
      sendBody("hours", { taskId: started.id }),
      { sub: "multi-turn-user" },
    );
    const completedJson = (await completedResponse.json()) as { task: Task };
    const completed = TaskSchema.parse(completedJson.task);
    expect(completed.id).toBe(started.id);
    expect(completed.status.state).toBe("TASK_STATE_COMPLETED");
    expect(completed.history).toHaveLength(4);
    expect(completed).not.toHaveProperty("metadata");

    const fetchedResponse = await call(
      slugs.acmeSlug,
      `tasks/${completed.id}?historyLength=0`,
      "GET",
      undefined,
      { sub: "multi-turn-user" },
    );
    const fetched = await readTask(fetchedResponse);
    expect(fetchedResponse.status).toBe(200);
    expect(fetched).not.toHaveProperty("contextId");
    expect(fetched.history).toEqual([]);

    const noHistory = await call(
      slugs.acmeSlug,
      `tasks/${completed.id}?historyLength=1`,
      "GET",
      undefined,
      { sub: "multi-turn-user" },
    );
    expect((await readTask(noHistory)).history).toHaveLength(1);
    await errorResponse(
      await call(
        slugs.acmeSlug,
        "message:send",
        "POST",
        sendBody("parking", { taskId: completed.id }),
        { sub: "multi-turn-user" },
      ),
      "UNSUPPORTED_OPERATION",
    );

    const flow = await testDb.query.conversations.findFirst({
      where: eq(conversations.id, completed.id),
    });
    expect(flow?.metadata.flow).toMatchObject({ awaitingFaqTopic: false });
  });

  it("round-trips context IDs and rejects mismatched continuations", async () => {
    const contextId = `ctx-${crypto.randomUUID()}`;
    const startedResponse = await call(
      slugs.acmeSlug,
      "message:send",
      "POST",
      sendBody("Can you help?", { contextId }),
      { sub: "context-user" },
    );
    const started = (await startedResponse.json()).task as Task;
    expect(started.contextId).toBe(contextId);
    expect(started.status.message?.contextId).toBe(contextId);

    const mismatch = await call(
      slugs.acmeSlug,
      "message:send",
      "POST",
      sendBody("hours", { taskId: started.id, contextId: `${contextId}-other` }),
      { sub: "context-user" },
    );
    await errorResponse(mismatch, "INVALID_ARGUMENT");

    const noContextStartedResponse = await call(
      slugs.acmeSlug,
      "message:send",
      "POST",
      sendBody("Can you help?"),
      { sub: "context-user" },
    );
    const noContextStarted = (await noContextStartedResponse.json()).task as Task;
    const noStoredContextMismatch = await call(
      slugs.acmeSlug,
      "message:send",
      "POST",
      sendBody("hours", { taskId: noContextStarted.id, contextId: "unexpected-context" }),
      { sub: "context-user" },
    );
    await errorResponse(noStoredContextMismatch, "INVALID_ARGUMENT");

    const answeredResponse = await call(
      slugs.acmeSlug,
      "message:send",
      "POST",
      sendBody("hours", { taskId: started.id }),
      { sub: "context-user" },
    );
    const answered = (await answeredResponse.json()).task as Task;
    expect(answered.contextId).toBe(contextId);
    expect(answered.history?.every((message) => message.contextId === contextId)).toBe(true);

    const fetched = await call(slugs.acmeSlug, `tasks/${started.id}`, "GET", undefined, {
      sub: "context-user",
    });
    expect(await fetched.json()).toMatchObject({ id: started.id, contextId });
    const listed = await call(slugs.acmeSlug, `tasks?contextId=${contextId}`, "GET", undefined, {
      sub: "context-user",
    });
    expect(await listed.json()).toMatchObject({
      tasks: [expect.objectContaining({ id: started.id })],
      totalSize: 1,
    });
  });

  it("scopes GetTask, ListTasks, and CancelTask to the authenticated user", async () => {
    const created = await call(slugs.acmeSlug, "message:send", "POST", sendBody("hours"), {
      sub: "owner",
    });
    const task = (await created.json()).task as Task;
    await errorResponse(
      await call(slugs.acmeSlug, `tasks/${task.id}`, "GET", undefined, { sub: "another-user" }),
      "TASK_NOT_FOUND",
    );
    const hidden = await call(slugs.acmeSlug, "tasks", "GET", undefined, {
      sub: "another-user",
    });
    expect(await hidden.json()).toMatchObject({ tasks: [], totalSize: 0 });
    await errorResponse(
      await call(
        slugs.acmeSlug,
        `tasks/${task.id}:cancel`,
        "POST",
        { id: task.id },
        {
          sub: "another-user",
        },
      ),
      "TASK_NOT_FOUND",
    );
    await errorResponse(
      await call(
        slugs.acmeSlug,
        `tasks/${task.id}:cancel`,
        "POST",
        { id: task.id },
        {
          sub: "owner",
        },
      ),
      "TASK_NOT_CANCELABLE",
    );
  });

  it("validates list query values and provides filtered cursor pagination", async () => {
    for (const path of [
      "tasks?pageSize=1.5",
      "tasks?pageSize=0",
      "tasks?historyLength=-1",
      "tasks?includeArtifacts=yes",
      "tasks?status=completed",
      "tasks?statusTimestampAfter=2025-01-01",
      "tasks?pageToken=not-a-token",
    ]) {
      await errorResponse(await call(slugs.acmeSlug, path), "INVALID_ARGUMENT");
    }
    await errorResponse(
      await call(slugs.acmeSlug, `tasks/${crypto.randomUUID()}?historyLength=1.5`),
      "INVALID_ARGUMENT",
    );

    const sub = `pagination-${crypto.randomUUID()}`;
    const ids: string[] = [];
    for (const text of ["hours", "parking", "insurance", "location"]) {
      const response = await call(slugs.acmeSlug, "message:send", "POST", sendBody(text), { sub });
      ids.push(((await response.json()).task as Task).id);
    }
    const firstResponse = await call(slugs.acmeSlug, "tasks?pageSize=1", "GET", undefined, { sub });
    const first = (await firstResponse.json()) as {
      tasks: Task[];
      nextPageToken: string;
      totalSize: number;
    };
    expect(first.tasks).toHaveLength(1);
    expect(first.nextPageToken).not.toBe("");
    expect(first.totalSize).toBe(4);

    const secondResponse = await call(
      slugs.acmeSlug,
      `tasks?pageSize=1&pageToken=${encodeURIComponent(first.nextPageToken)}`,
      "GET",
      undefined,
      { sub },
    );
    const second = (await secondResponse.json()) as { tasks: Task[]; nextPageToken: string };
    expect(second.tasks).toHaveLength(1);
    expect(second.tasks[0]?.id).not.toBe(first.tasks[0]?.id);

    const lastResponse = await call(
      slugs.acmeSlug,
      `tasks?pageSize=2&pageToken=${encodeURIComponent(second.nextPageToken)}`,
      "GET",
      undefined,
      { sub },
    );
    expect(await lastResponse.json()).toMatchObject({
      tasks: [{}, {}],
      nextPageToken: "",
      totalSize: 4,
    });
    const statusFilter = await call(
      slugs.acmeSlug,
      "tasks?status=TASK_STATE_COMPLETED",
      "GET",
      undefined,
      { sub },
    );
    expect(await statusFilter.json()).toMatchObject({ totalSize: 4 });
    expect(ids).toHaveLength(4);
  });
});

afterAll(async () => {
  await client?.close();
});

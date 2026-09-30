import { randomUUID } from "node:crypto";
import {
  A2A_ERRORS,
  A2A_VERSION,
  CancelTaskRequestSchema,
  GetTaskRequestSchema,
  ListTasksRequestSchema,
  SendMessageRequestSchema,
  TaskStateSchema,
  type Message,
  type Task,
  type TaskState,
} from "@pap/protocol";
import { and, desc, eq, gt, lt, or, sql } from "drizzle-orm";
import type { JWTVerifyGetKey } from "jose";
import { runAgentTurn } from "../agent/index.js";
import { verifyPlatformJwt } from "../auth/verifyPlatformJwt.js";
import type { Db } from "../db/client.js";
import { conversations, customers, messages } from "../db/schema.js";
import { buildAgentCard } from "./agentCard.js";
import { getProviderBaseUrl } from "./providerBaseUrl.js";

type A2AErrorReason = keyof typeof A2A_ERRORS;
type HandlerRoute =
  | { kind: "agentCard" }
  | { kind: "sendMessage" }
  | { kind: "getTask"; id: string }
  | { kind: "listTasks" }
  | { kind: "cancelTask"; id: string }
  | { kind: "unsupported" }
  | { kind: "extendedAgentCard" };

type HandlerOptions = {
  db: Db;
  getJwks?: (uri: string) => JWTVerifyGetKey;
  now?: () => Date;
};

export type A2AHandler = (
  request: Request,
  slug: string,
  pathSegments: string[],
) => Promise<Response>;

function response(body: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(body, { status, ...(headers ? { headers } : {}) });
}

function a2aError(reason: A2AErrorReason, message: string): Response {
  const { httpStatus, status } = A2A_ERRORS[reason];
  return response(
    {
      error: {
        code: httpStatus,
        status,
        message,
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.ErrorInfo",
            reason,
            domain: "a2a-protocol.org",
          },
        ],
      },
    },
    httpStatus,
  );
}

class HandlerError extends Error {
  constructor(
    readonly reason: A2AErrorReason,
    message: string,
  ) {
    super(message);
  }
}

function notFound(): Response {
  return new Response(null, { status: 404 });
}

function matchRoute(method: string, segments: string[]): HandlerRoute | null {
  const path = segments.map((segment) => segment.replace(/%3a/gi, ":"));
  if (
    method === "GET" &&
    path.length === 2 &&
    path[0] === ".well-known" &&
    path[1] === "agent-card.json"
  )
    return { kind: "agentCard" };
  if (method === "POST" && path.length === 1 && path[0] === "message:send")
    return { kind: "sendMessage" };
  if (method === "POST" && path.length === 1 && path[0] === "message:stream")
    return { kind: "unsupported" };
  if (method === "GET" && path.length === 1 && path[0] === "tasks") return { kind: "listTasks" };
  if (method === "POST" && path.length === 2 && path[0] === "tasks") {
    const cancelMatch = path[1]?.match(/^(.+):cancel$/);
    if (cancelMatch?.[1]) return { kind: "cancelTask", id: cancelMatch[1] };
    if (path[1]?.match(/^.+:subscribe$/)) return { kind: "unsupported" };
  }
  if (
    (method === "GET" || method === "POST") &&
    path.length === 2 &&
    path[0] === "tasks" &&
    path[1]?.match(/^.+:subscribe$/)
  ) {
    return { kind: "unsupported" };
  }
  if (method === "GET" && path.length === 2 && path[0] === "tasks" && path[1])
    return { kind: "getTask", id: path[1] };
  if (
    (method === "GET" || method === "POST" || method === "DELETE") &&
    path.length >= 3 &&
    path[0] === "tasks" &&
    path[1] &&
    path[2] === "pushNotificationConfigs"
  ) {
    return { kind: "unsupported" };
  }
  if (method === "GET" && path.length === 1 && path[0] === "extendedAgentCard")
    return { kind: "extendedAgentCard" };
  return null;
}

function unsupportedOperation(): Response {
  return a2aError("UNSUPPORTED_OPERATION", "Unsupported operation");
}

function requireContentType(request: Request): void {
  const contentType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (contentType !== "application/json" && contentType !== "application/a2a+json") {
    throw new HandlerError("CONTENT_TYPE_NOT_SUPPORTED", "Content type not supported");
  }
}

async function readJsonBody(request: Request): Promise<unknown> {
  requireContentType(request);
  try {
    return await request.json();
  } catch {
    throw new HandlerError("INVALID_ARGUMENT", "Invalid JSON request body");
  }
}

function queryValue(url: URL, name: string): string | undefined {
  const values = url.searchParams.getAll(name);
  if (values.length > 1)
    throw new HandlerError("INVALID_ARGUMENT", `Invalid query parameter: ${name}`);
  return values[0];
}

function integerQuery(url: URL, name: string): number | undefined {
  const value = queryValue(url, name);
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) {
    throw new HandlerError("INVALID_ARGUMENT", `Invalid integer query parameter: ${name}`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new HandlerError("INVALID_ARGUMENT", `Invalid integer query parameter: ${name}`);
  }
  return parsed;
}

function getTaskQuery(url: URL, id: string): { id: string; historyLength?: number } {
  const historyLength = integerQuery(url, "historyLength");
  const request = {
    id,
    ...(historyLength === undefined ? {} : { historyLength }),
  };
  const parsed = GetTaskRequestSchema.safeParse(request);
  if (!parsed.success) throw new HandlerError("INVALID_ARGUMENT", "Invalid query parameters");
  return {
    id: parsed.data.id,
    ...(parsed.data.historyLength === undefined
      ? {}
      : { historyLength: parsed.data.historyLength }),
  };
}

function listTasksQuery(url: URL) {
  const status = queryValue(url, "status");
  if (status !== undefined && !TaskStateSchema.safeParse(status).success) {
    throw new HandlerError("INVALID_ARGUMENT", "Invalid status query parameter");
  }
  const includeArtifacts = queryValue(url, "includeArtifacts");
  if (
    includeArtifacts !== undefined &&
    includeArtifacts !== "true" &&
    includeArtifacts !== "false"
  ) {
    throw new HandlerError("INVALID_ARGUMENT", "Invalid boolean query parameter: includeArtifacts");
  }
  const contextId = queryValue(url, "contextId");
  const pageSize = integerQuery(url, "pageSize");
  const pageToken = queryValue(url, "pageToken");
  const historyLength = integerQuery(url, "historyLength");
  const statusTimestampAfter = queryValue(url, "statusTimestampAfter");
  const request = {
    ...(contextId === undefined ? {} : { contextId }),
    ...(status === undefined ? {} : { status }),
    ...(pageSize === undefined ? {} : { pageSize }),
    ...(pageToken === undefined ? {} : { pageToken }),
    ...(historyLength === undefined ? {} : { historyLength }),
    ...(statusTimestampAfter === undefined ? {} : { statusTimestampAfter }),
    ...(includeArtifacts === undefined ? {} : { includeArtifacts: includeArtifacts === "true" }),
  };
  const parsed = ListTasksRequestSchema.safeParse(request);
  if (!parsed.success) throw new HandlerError("INVALID_ARGUMENT", "Invalid query parameters");
  return parsed.data;
}

function decodePageToken(token: string): { updatedAt: Date; id: string } | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
    if (
      typeof value !== "object" ||
      value === null ||
      !("u" in value) ||
      typeof value.u !== "string" ||
      !("id" in value) ||
      typeof value.id !== "string"
    ) {
      return null;
    }
    const updatedAt = new Date(value.u);
    if (Number.isNaN(updatedAt.getTime())) return null;
    return { updatedAt, id: value.id };
  } catch {
    return null;
  }
}

export function createA2AHandler(options: HandlerOptions): A2AHandler {
  return async (request, slug, pathSegments) => {
    const route = matchRoute(request.method, pathSegments);
    if (!route) return notFound();

    if (route.kind === "agentCard") {
      try {
        const customer = await options.db.query.customers.findFirst({
          where: eq(customers.slug, slug),
        });
        if (!customer) return notFound();
        const card = buildAgentCard(customer, getProviderBaseUrl(request));
        return response(card, 200, {
          "Cache-Control": "public, max-age=60",
          "Access-Control-Allow-Origin": "*",
        });
      } catch (error) {
        console.error("A2A agent card request failed", error);
        return response({ error: "Internal error" }, 500);
      }
    }

    const baseUrl = getProviderBaseUrl(request);
    const auth = await verifyPlatformJwt({
      authorization: request.headers.get("authorization"),
      slug,
      expectedAud: `${baseUrl}/a2a/${slug}`,
      db: options.db,
      ...(options.getJwks ? { getJwks: options.getJwks } : {}),
      ...(options.now ? { now: options.now } : {}),
    });
    if (!auth) {
      return new Response(null, {
        status: 401,
        headers: { "WWW-Authenticate": 'Bearer realm="a2a"' },
      });
    }

    if (request.headers.get("A2A-Version") !== A2A_VERSION) {
      return a2aError("VERSION_NOT_SUPPORTED", "Version not supported");
    }

    if (route.kind === "unsupported") return unsupportedOperation();
    if (route.kind === "extendedAgentCard") {
      return a2aError("EXTENDED_AGENT_CARD_NOT_CONFIGURED", "Extended agent card not configured");
    }

    try {
      if (route.kind === "sendMessage") {
        const rawBody = await readJsonBody(request);
        const parsed = SendMessageRequestSchema.safeParse(rawBody);
        if (!parsed.success) throw new HandlerError("INVALID_ARGUMENT", "Invalid request body");
        const requestMessage = parsed.data.message;
        if (requestMessage.role !== "ROLE_USER") {
          throw new HandlerError("INVALID_ARGUMENT", "Message role must be ROLE_USER");
        }
        if (requestMessage.parts.some((part) => !("text" in part))) {
          throw new HandlerError("CONTENT_TYPE_NOT_SUPPORTED", "Content type not supported");
        }
        if (
          parsed.data.configuration?.returnImmediately === true ||
          parsed.data.configuration?.taskPushNotificationConfig !== undefined
        ) {
          return unsupportedOperation();
        }

        const task = await options.db.transaction(async (tx) => {
          const transactionDb = tx as unknown as Db;
          let conversation: typeof conversations.$inferSelect;
          if (requestMessage.taskId) {
            const [found] = await transactionDb
              .select()
              .from(conversations)
              .where(
                and(
                  eq(conversations.id, requestMessage.taskId),
                  eq(conversations.customerId, auth.customer.id),
                  eq(conversations.userId, auth.paUserId),
                ),
              )
              .for("update");
            if (!found) {
              throw new HandlerError("TASK_NOT_FOUND", "Task not found");
            }
            if (
              requestMessage.contextId !== undefined &&
              requestMessage.contextId !== found.metadata.contextId
            ) {
              throw new HandlerError("INVALID_ARGUMENT", "Context ID does not match the task");
            }
            if (
              [
                "TASK_STATE_COMPLETED",
                "TASK_STATE_FAILED",
                "TASK_STATE_CANCELED",
                "TASK_STATE_REJECTED",
              ].includes(found.state)
            ) {
              throw new HandlerError("UNSUPPORTED_OPERATION", "Unsupported operation");
            }
            conversation = found;
          } else {
            const [created] = await transactionDb
              .insert(conversations)
              .values({
                id: randomUUID(),
                customerId: auth.customer.id,
                userId: auth.paUserId,
                state: "TASK_STATE_SUBMITTED",
                metadata: {
                  ...(requestMessage.contextId === undefined
                    ? {}
                    : { contextId: requestMessage.contextId }),
                  flow: {},
                },
              })
              .returning();
            if (!created) throw new Error("Conversation insert returned no row");
            conversation = created;
          }

          const duplicate = await transactionDb
            .select({ id: messages.id })
            .from(messages)
            .where(
              and(
                eq(messages.conversationId, conversation.id),
                eq(messages.messageId, requestMessage.messageId),
              ),
            )
            .limit(1);
          if (duplicate.length) {
            throw new HandlerError("INVALID_ARGUMENT", "Message ID was already used");
          }

          const [lastMessage] = await transactionDb
            .select({ createdAt: messages.createdAt })
            .from(messages)
            .where(eq(messages.conversationId, conversation.id))
            .orderBy(desc(messages.createdAt), desc(messages.id))
            .limit(1);
          const messageCreatedAt = new Date(
            Math.max(
              options.now?.().getTime() ?? Date.now(),
              (lastMessage?.createdAt.getTime() ?? 0) + 1,
            ),
          );
          const contextId = conversation.metadata.contextId;
          const userMessage: Message = {
            ...requestMessage,
            ...(contextId === undefined ? {} : { contextId }),
            taskId: conversation.id,
          };
          await transactionDb.insert(messages).values({
            conversationId: conversation.id,
            messageId: userMessage.messageId,
            role: "ROLE_USER",
            parts: userMessage.parts,
            createdAt: messageCreatedAt,
          });

          const inputText = requestMessage.parts
            .map((part) => ("text" in part ? part.text : ""))
            .join("\n");
          const turn = await runAgentTurn({
            customerName: auth.customer.name,
            initialText: inputText,
            previousFlow: conversation.metadata.flow ?? {},
          });
          const updatedAt = options.now?.() ?? new Date();
          const agentMessage: Message = {
            messageId: randomUUID(),
            ...(contextId === undefined ? {} : { contextId }),
            taskId: conversation.id,
            role: "ROLE_AGENT",
            parts: [{ text: turn.text, mediaType: "text/plain" }],
          };
          await transactionDb.insert(messages).values({
            conversationId: conversation.id,
            messageId: agentMessage.messageId,
            role: "ROLE_AGENT",
            parts: agentMessage.parts,
            createdAt: new Date(messageCreatedAt.getTime() + 1),
          });
          const [updated] = await transactionDb
            .update(conversations)
            .set({
              state: turn.state,
              metadata: { ...conversation.metadata, flow: turn.flow },
              updatedAt,
            })
            .where(eq(conversations.id, conversation.id))
            .returning();
          if (!updated) throw new Error("Conversation update returned no row");

          const historyRows = await transactionDb
            .select()
            .from(messages)
            .where(eq(messages.conversationId, conversation.id))
            .orderBy(messages.createdAt, messages.id);
          const history = historyRows.map(
            (message): Message => ({
              messageId: message.messageId,
              ...(updated.metadata.contextId === undefined
                ? {}
                : { contextId: updated.metadata.contextId }),
              taskId: updated.id,
              role: message.role as Message["role"],
              parts: message.parts as Message["parts"],
            }),
          );
          const historyLength = parsed.data.configuration?.historyLength;
          const boundedHistory =
            historyLength === 0
              ? []
              : historyLength === undefined
                ? history
                : history.slice(-historyLength);
          const result: Task = {
            id: updated.id,
            ...(updated.metadata.contextId === undefined
              ? {}
              : { contextId: updated.metadata.contextId }),
            status: {
              state: updated.state as TaskState,
              message: agentMessage,
              timestamp: updated.updatedAt.toISOString(),
            },
            history: boundedHistory,
          };
          return result;
        });
        return response({ task });
      }

      if (route.kind === "getTask") {
        const query = getTaskQuery(new URL(request.url), route.id);
        const task = await loadTask(
          options.db,
          query.id,
          auth.customer.id,
          auth.paUserId,
          query.historyLength,
        );
        if (!task) throw new HandlerError("TASK_NOT_FOUND", "Task not found");
        return response(task);
      }

      if (route.kind === "listTasks") {
        const query = listTasksQuery(new URL(request.url));
        const pageSize = query.pageSize ?? 50;
        const filter = and(
          eq(conversations.customerId, auth.customer.id),
          eq(conversations.userId, auth.paUserId),
          ...(query.contextId === undefined
            ? []
            : [sql`${conversations.metadata}->>'contextId' = ${query.contextId}`]),
          ...(query.status ? [eq(conversations.state, query.status)] : []),
          ...(query.statusTimestampAfter
            ? [gt(conversations.updatedAt, new Date(query.statusTimestampAfter))]
            : []),
        );
        const cursor = query.pageToken ? decodePageToken(query.pageToken) : null;
        if (query.pageToken && !cursor) {
          throw new HandlerError("INVALID_ARGUMENT", "Invalid page token");
        }
        const cursorFilter =
          cursor === null
            ? undefined
            : or(
                lt(conversations.updatedAt, cursor.updatedAt),
                and(eq(conversations.updatedAt, cursor.updatedAt), lt(conversations.id, cursor.id)),
              );
        const rows = await options.db
          .select()
          .from(conversations)
          .where(cursorFilter ? and(filter, cursorFilter) : filter)
          .orderBy(desc(conversations.updatedAt), desc(conversations.id))
          .limit(pageSize + 1);
        const totalResult = await options.db
          .select({ value: sql<number>`count(*)::int` })
          .from(conversations)
          .where(filter);
        const more = rows.length > pageSize;
        const pageRows = rows.slice(0, pageSize);
        const tasks: Task[] = [];
        for (const row of pageRows) {
          const task = await loadTask(
            options.db,
            row.id,
            auth.customer.id,
            auth.paUserId,
            query.historyLength,
            query.includeArtifacts,
          );
          if (task) tasks.push(task);
        }
        const last = pageRows.at(-1);
        const nextPageToken =
          more && last
            ? Buffer.from(
                JSON.stringify({ u: last.updatedAt.toISOString(), id: last.id }),
              ).toString("base64url")
            : "";
        return response({
          tasks,
          nextPageToken,
          pageSize,
          totalSize: totalResult[0]?.value ?? 0,
        });
      }

      if (route.kind === "cancelTask") {
        const rawBody = await readJsonBody(request);
        if (typeof rawBody !== "object" || rawBody === null || Array.isArray(rawBody)) {
          throw new HandlerError("INVALID_ARGUMENT", "Invalid cancel request body");
        }
        const parsed = CancelTaskRequestSchema.safeParse({ ...rawBody, id: route.id });
        if (!parsed.success) {
          throw new HandlerError("INVALID_ARGUMENT", "Invalid cancel request body");
        }
        const [task] = await options.db
          .select({ id: conversations.id })
          .from(conversations)
          .where(
            and(
              eq(conversations.id, route.id),
              eq(conversations.customerId, auth.customer.id),
              eq(conversations.userId, auth.paUserId),
            ),
          )
          .limit(1);
        if (!task) throw new HandlerError("TASK_NOT_FOUND", "Task not found");
        return a2aError("TASK_NOT_CANCELABLE", "Task not cancelable");
      }
    } catch (error) {
      if (error instanceof HandlerError) return a2aError(error.reason, error.message);
      if (
        error instanceof Error &&
        error.message.includes("messages_conversation_message_unique")
      ) {
        return a2aError("INVALID_ARGUMENT", "Message ID was already used");
      }
      console.error("A2A request failed", error);
      return a2aError("INTERNAL", "Internal error");
    }

    return notFound();
  };
}

async function loadTask(
  db: Db,
  id: string,
  customerId: string,
  paUserId: string,
  historyLength?: number,
  includeArtifacts = false,
): Promise<Task | null> {
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.id, id),
        eq(conversations.customerId, customerId),
        eq(conversations.userId, paUserId),
      ),
    )
    .limit(1);
  if (!conversation) return null;
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversation.id))
    .orderBy(messages.createdAt, messages.id);
  const history: Message[] = rows.map((message) => ({
    messageId: message.messageId,
    ...(conversation.metadata.contextId === undefined
      ? {}
      : { contextId: conversation.metadata.contextId }),
    taskId: conversation.id,
    role: message.role as Message["role"],
    parts: message.parts as Message["parts"],
  }));
  const statusMessage = [...history].reverse().find((message) => message.role === "ROLE_AGENT");
  const result: Task = {
    id: conversation.id,
    ...(conversation.metadata.contextId === undefined
      ? {}
      : { contextId: conversation.metadata.contextId }),
    status: {
      state: conversation.state as TaskState,
      ...(statusMessage ? { message: statusMessage } : {}),
      timestamp: conversation.updatedAt.toISOString(),
    },
    history:
      historyLength === 0
        ? []
        : historyLength === undefined
          ? history
          : history.slice(-historyLength),
  };
  if (includeArtifacts) result.artifacts = [];
  return result;
}

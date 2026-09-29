import { randomUUID } from "node:crypto";
import {
  A2A_ERROR_CODES,
  A2A_METHODS,
  A2A_VERSION,
  CancelTaskRequestSchema,
  GetTaskRequestSchema,
  ListTasksRequestSchema,
  SendMessageRequestSchema,
  type Message,
  type Task,
  type TaskState,
} from "@pap/protocol";
import { and, desc, eq, gt, lt, or, sql } from "drizzle-orm";
import type { JWTVerifyGetKey } from "jose";
import { runAgentTurn, type FlowState } from "../agent/index.js";
import { verifyPlatformJwt } from "../auth/verifyPlatformJwt.js";
import type { Db } from "../db/client.js";
import { conversations, messages, rateLimitWindows } from "../db/schema.js";

type RpcId = string | number | null;
type ErrorPayload = {
  jsonrpc: "2.0";
  id: RpcId;
  error: { code: number; message: string; data?: unknown };
};

function response(body: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(body, { status, ...(headers ? { headers } : {}) });
}

function a2aError(
  id: RpcId,
  code: number,
  message: string,
  reason?: string,
  extra?: unknown,
): ErrorPayload {
  let data: unknown;
  if (reason) {
    data = [
      {
        "@type": "type.googleapis.com/google.rpc.ErrorInfo",
        reason,
        domain: "a2a-protocol.org",
      },
    ];
  } else if (extra !== undefined) {
    data = extra;
  }
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  };
}

function providerBaseUrl(request: Request): string {
  const base =
    process.env.PROVIDER_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : new URL(request.url).origin);
  return base.replace(/\/+$/, "");
}

function decodePageToken(token: string): { u: string; id: string } | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
    if (
      typeof value === "object" &&
      value !== null &&
      "u" in value &&
      typeof value.u === "string" &&
      "id" in value &&
      typeof value.id === "string"
    ) {
      return { u: value.u, id: value.id };
    }
    return null;
  } catch {
    return null;
  }
}

type HandlerOptions = {
  db: Db;
  getJwks?: (uri: string) => JWTVerifyGetKey;
  now?: () => Date;
  config?: { sendMessageLimitPerMinute?: number };
};

export function createA2AHandler(
  options: HandlerOptions,
): (request: Request, slug: string) => Promise<Response> {
  return async (request, slug) => {
    if (request.method !== "POST")
      return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
    const baseUrl = providerBaseUrl(request);
    const url = new URL(request.url);
    const audience = `${baseUrl}/a2a/${slug}`;
    const auth = await verifyPlatformJwt({
      authorization: request.headers.get("authorization"),
      slug,
      expectedAud: audience,
      db: options.db,
      ...(options.getJwks ? { getJwks: options.getJwks } : {}),
      ...(options.now ? { now: options.now } : {}),
    });
    if (!auth) {
      return response(a2aError(null, A2A_ERROR_CODES.unauthorized, "Unauthorized"), 401, {
        "WWW-Authenticate": 'Bearer realm="a2a"',
      });
    }
    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return response(a2aError(null, A2A_ERROR_CODES.parseError, "Invalid JSON payload"));
    }
    if (Array.isArray(rawBody)) {
      return response(
        a2aError(null, A2A_ERROR_CODES.invalidRequest, "Request payload validation error"),
      );
    }
    if (
      typeof rawBody !== "object" ||
      rawBody === null ||
      !("jsonrpc" in rawBody) ||
      rawBody.jsonrpc !== "2.0" ||
      !("id" in rawBody) ||
      !("method" in rawBody) ||
      typeof rawBody.method !== "string" ||
      !rawBody.method ||
      ("params" in rawBody &&
        rawBody.params !== undefined &&
        (typeof rawBody.params !== "object" ||
          rawBody.params === null ||
          Array.isArray(rawBody.params)))
    ) {
      return response(
        a2aError(null, A2A_ERROR_CODES.invalidRequest, "Request payload validation error"),
      );
    }
    const rpcId =
      typeof rawBody.id === "string" || typeof rawBody.id === "number" || rawBody.id === null
        ? rawBody.id
        : null;
    if (
      !(typeof rawBody.id === "string" || typeof rawBody.id === "number" || rawBody.id === null)
    ) {
      return response(
        a2aError(null, A2A_ERROR_CODES.invalidRequest, "Request payload validation error"),
      );
    }
    const version = request.headers.get("A2A-Version") ?? url.searchParams.get("A2A-Version");
    if (version !== A2A_VERSION) {
      return response(
        a2aError(
          rpcId,
          A2A_ERROR_CODES.versionNotSupported,
          "Version not supported",
          "VERSION_NOT_SUPPORTED",
        ),
      );
    }
    const method = rawBody.method;
    const supported = new Set<string>(Object.values(A2A_METHODS));
    if (!supported.has(method))
      return response(a2aError(rpcId, A2A_ERROR_CODES.methodNotFound, "Method not found"));
    const params = "params" in rawBody ? rawBody.params : undefined;
    const now = options.now?.() ?? new Date();

    if (method === A2A_METHODS.sendMessage) {
      const windowStart = new Date(now);
      windowStart.setUTCSeconds(0, 0);
      const limit =
        options.config?.sendMessageLimitPerMinute ??
        Number.parseInt(process.env.A2A_SEND_MESSAGE_LIMIT_PER_MINUTE ?? "20", 10);
      const [window] = await options.db
        .insert(rateLimitWindows)
        .values({ platformId: auth.platform.id, windowStart, count: 1 })
        .onConflictDoUpdate({
          target: [rateLimitWindows.platformId, rateLimitWindows.windowStart],
          set: { count: sql`${rateLimitWindows.count} + 1` },
        })
        .returning({ count: rateLimitWindows.count });
      if ((window?.count ?? 0) > limit) {
        const retryAfter = Math.max(
          1,
          Math.ceil((windowStart.getTime() + 60_000 - now.getTime()) / 1000),
        );
        return response(a2aError(rpcId, A2A_ERROR_CODES.unauthorized, "Rate limit exceeded"), 429, {
          "Retry-After": String(retryAfter),
        });
      }
      const parsed = SendMessageRequestSchema.safeParse(params);
      if (!parsed.success) {
        return response(
          a2aError(
            rpcId,
            A2A_ERROR_CODES.invalidParams,
            "Invalid parameters",
            undefined,
            parsed.error.issues,
          ),
        );
      }
      const requestMessage = parsed.data.message;
      if (requestMessage.role !== "ROLE_USER") {
        return response(a2aError(rpcId, A2A_ERROR_CODES.invalidParams, "Invalid parameters"));
      }
      if (requestMessage.parts.some((part) => !("text" in part))) {
        return response(
          a2aError(
            rpcId,
            A2A_ERROR_CODES.contentTypeNotSupported,
            "Content type not supported",
            "CONTENT_TYPE_NOT_SUPPORTED",
          ),
        );
      }
      if (
        parsed.data.configuration?.returnImmediately === true ||
        parsed.data.configuration?.taskPushNotificationConfig !== undefined
      ) {
        return response(
          a2aError(
            rpcId,
            A2A_ERROR_CODES.unsupportedOperation,
            "Unsupported operation",
            "UNSUPPORTED_OPERATION",
          ),
        );
      }
      try {
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
                  eq(conversations.platformId, auth.platform.id),
                  eq(conversations.paUserId, auth.paUserId),
                ),
              )
              .for("update");
            if (!found)
              throw new RpcFailure(
                A2A_ERROR_CODES.taskNotFound,
                "Task not found",
                "TASK_NOT_FOUND",
              );
            if (requestMessage.contextId && requestMessage.contextId !== found.contextId) {
              throw new RpcFailure(A2A_ERROR_CODES.invalidParams, "Invalid parameters");
            }
            if (
              [
                "TASK_STATE_COMPLETED",
                "TASK_STATE_FAILED",
                "TASK_STATE_CANCELED",
                "TASK_STATE_REJECTED",
              ].includes(found.state)
            ) {
              throw new RpcFailure(
                A2A_ERROR_CODES.unsupportedOperation,
                "Unsupported operation",
                "UNSUPPORTED_OPERATION",
              );
            }
            conversation = found;
          } else {
            const id = randomUUID();
            const [created] = await transactionDb
              .insert(conversations)
              .values({
                id,
                customerId: auth.customer.id,
                platformId: auth.platform.id,
                channel: "pa",
                paUserId: auth.paUserId,
                contextId: requestMessage.contextId ?? randomUUID(),
                state: "TASK_STATE_SUBMITTED",
                metadata: { pa_platform: auth.platform.name, flow: {} },
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
          if (duplicate.length)
            throw new RpcFailure(A2A_ERROR_CODES.invalidParams, "Invalid parameters");
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
          const userMessage: Message = {
            ...requestMessage,
            contextId: requestMessage.contextId ?? conversation.contextId,
            taskId: conversation.id,
          };
          await transactionDb.insert(messages).values({
            conversationId: conversation.id,
            messageId: userMessage.messageId,
            role: "ROLE_USER",
            parts: userMessage.parts,
            createdAt: messageCreatedAt,
          });
          const metadata = conversation.metadata;
          const flow = (
            typeof metadata.flow === "object" && metadata.flow !== null ? metadata.flow : {}
          ) as FlowState;
          const inputText = requestMessage.parts
            .map((part) => ("text" in part ? part.text : ""))
            .join("\n");
          const turn = await runAgentTurn({
            db: transactionDb,
            customerId: auth.customer.id,
            customerName: auth.customer.name,
            initialText: inputText,
            previousAopId: conversation.aopId,
            previousVerifiedUserId: conversation.verifiedCustomerUserId,
            previousFlow: flow,
            ...(options.now ? { now: options.now } : {}),
          });
          const updatedAt = options.now?.() ?? new Date();
          const agentMessage: Message = {
            messageId: randomUUID(),
            contextId: conversation.contextId,
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
              aopId: turn.aopId,
              verifiedCustomerUserId: turn.verifiedCustomerUserId,
              metadata: { ...metadata, pa_platform: auth.platform.name, flow: turn.flow },
              updatedAt,
            })
            .where(eq(conversations.id, conversation.id))
            .returning();
          if (!updated) throw new Error("Conversation update returned no row");
          const history = await transactionDb
            .select()
            .from(messages)
            .where(eq(messages.conversationId, conversation.id))
            .orderBy(messages.createdAt, messages.id);
          const mappedHistory = history.map(
            (message): Message => ({
              messageId: message.messageId,
              contextId: updated.contextId,
              taskId: updated.id,
              role: message.role as Message["role"],
              parts: message.parts as Message["parts"],
            }),
          );
          const limitLength = parsed.data.configuration?.historyLength;
          const boundedHistory =
            limitLength === 0
              ? []
              : limitLength === undefined
                ? mappedHistory
                : mappedHistory.slice(-limitLength);
          const result: Task = {
            id: updated.id,
            contextId: updated.contextId,
            status: {
              state: updated.state as TaskState,
              message: agentMessage,
              timestamp: updated.updatedAt.toISOString(),
            },
            history: boundedHistory,
            metadata: { channel: "pa", paPlatform: auth.platform.name, aopId: turn.aopId },
          };
          return result;
        });
        return response({ jsonrpc: "2.0", id: rpcId, result: { task } });
      } catch (error) {
        if (error instanceof RpcFailure) {
          return response(a2aError(rpcId, error.code, error.message, error.reason));
        }
        if (
          error instanceof Error &&
          error.message.includes("messages_conversation_message_unique")
        ) {
          return response(a2aError(rpcId, A2A_ERROR_CODES.invalidParams, "Invalid parameters"));
        }
        console.error("A2A SendMessage failed", error);
        return response(a2aError(rpcId, A2A_ERROR_CODES.internalError, "Internal error"));
      }
    }

    if (method === A2A_METHODS.getTask) {
      const parsed = GetTaskRequestSchema.safeParse(params);
      if (!parsed.success)
        return response(
          a2aError(
            rpcId,
            A2A_ERROR_CODES.invalidParams,
            "Invalid parameters",
            undefined,
            parsed.error.issues,
          ),
        );
      const task = await loadTask(
        options.db,
        parsed.data.id,
        auth.customer.id,
        auth.platform.id,
        auth.paUserId,
        parsed.data.historyLength,
      );
      if (!task)
        return response(
          a2aError(rpcId, A2A_ERROR_CODES.taskNotFound, "Task not found", "TASK_NOT_FOUND"),
        );
      return response({ jsonrpc: "2.0", id: rpcId, result: task });
    }
    if (method === A2A_METHODS.listTasks) {
      const parsed = ListTasksRequestSchema.safeParse(params);
      if (!parsed.success)
        return response(
          a2aError(
            rpcId,
            A2A_ERROR_CODES.invalidParams,
            "Invalid parameters",
            undefined,
            parsed.error.issues,
          ),
        );
      const pageSize = parsed.data.pageSize ?? 50;
      const filter = and(
        eq(conversations.customerId, auth.customer.id),
        eq(conversations.platformId, auth.platform.id),
        eq(conversations.paUserId, auth.paUserId),
        ...(parsed.data.contextId ? [eq(conversations.contextId, parsed.data.contextId)] : []),
        ...(parsed.data.status ? [eq(conversations.state, parsed.data.status)] : []),
        ...(parsed.data.statusTimestampAfter
          ? [gt(conversations.updatedAt, new Date(parsed.data.statusTimestampAfter))]
          : []),
      );
      const cursor = parsed.data.pageToken ? decodePageToken(parsed.data.pageToken) : null;
      if (parsed.data.pageToken && !cursor) {
        return response(a2aError(rpcId, A2A_ERROR_CODES.invalidParams, "Invalid parameters"));
      }
      const cursorFilter =
        cursor === null
          ? undefined
          : or(
              lt(conversations.updatedAt, new Date(cursor.u)),
              and(eq(conversations.updatedAt, new Date(cursor.u)), lt(conversations.id, cursor.id)),
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
          auth.platform.id,
          auth.paUserId,
          parsed.data.historyLength,
          parsed.data.includeArtifacts,
        );
        if (task) tasks.push(task);
      }
      const last = pageRows.at(-1);
      const nextPageToken =
        more && last
          ? Buffer.from(JSON.stringify({ u: last.updatedAt.toISOString(), id: last.id })).toString(
              "base64url",
            )
          : "";
      return response({
        jsonrpc: "2.0",
        id: rpcId,
        result: {
          tasks,
          nextPageToken,
          pageSize,
          totalSize: totalResult[0]?.value ?? 0,
        },
      });
    }
    if (method === A2A_METHODS.cancelTask) {
      const parsed = CancelTaskRequestSchema.safeParse(params);
      if (!parsed.success)
        return response(
          a2aError(
            rpcId,
            A2A_ERROR_CODES.invalidParams,
            "Invalid parameters",
            undefined,
            parsed.error.issues,
          ),
        );
      return response(
        a2aError(
          rpcId,
          A2A_ERROR_CODES.taskNotCancelable,
          "Task not cancelable",
          "TASK_NOT_CANCELABLE",
        ),
      );
    }
    if (method === A2A_METHODS.getExtendedAgentCard) {
      return response(
        a2aError(
          rpcId,
          A2A_ERROR_CODES.extendedAgentCardNotConfigured,
          "Extended agent card not configured",
          "EXTENDED_AGENT_CARD_NOT_CONFIGURED",
        ),
      );
    }
    const unsupportedMethods = new Set<string>([
      A2A_METHODS.sendStreamingMessage,
      A2A_METHODS.subscribeToTask,
      A2A_METHODS.createTaskPushNotificationConfig,
      A2A_METHODS.getTaskPushNotificationConfig,
      A2A_METHODS.listTaskPushNotificationConfigs,
      A2A_METHODS.deleteTaskPushNotificationConfig,
    ]);
    if (unsupportedMethods.has(method)) {
      return response(
        a2aError(
          rpcId,
          A2A_ERROR_CODES.unsupportedOperation,
          "Unsupported operation",
          "UNSUPPORTED_OPERATION",
        ),
      );
    }
    return response(a2aError(rpcId, A2A_ERROR_CODES.methodNotFound, "Method not found"));
  };
}

class RpcFailure extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly reason?: string,
  ) {
    super(message);
  }
}

async function loadTask(
  db: Db,
  id: string,
  customerId: string,
  platformId: string,
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
        eq(conversations.platformId, platformId),
        eq(conversations.paUserId, paUserId),
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
    contextId: conversation.contextId,
    taskId: conversation.id,
    role: message.role as Message["role"],
    parts: message.parts as Message["parts"],
  }));
  const statusMessage = [...history].reverse().find((message) => message.role === "ROLE_AGENT");
  const metadata = conversation.metadata;
  const result: Task = {
    id: conversation.id,
    contextId: conversation.contextId,
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
    metadata: {
      channel: conversation.channel,
      paPlatform: metadata.pa_platform,
      aopId: conversation.aopId,
    },
  };
  if (includeArtifacts) result.artifacts = [];
  return result;
}

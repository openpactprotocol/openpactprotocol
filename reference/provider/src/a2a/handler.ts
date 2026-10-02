import { randomUUID } from "node:crypto";
import {
  A2A_ERRORS,
  ListTasksResponseSchema,
  MessageSchema,
  SendMessageRequestSchema,
  SendMessageResponseSchema,
  type Message,
} from "@openpactprotocol/protocol";
import { and, asc, eq } from "drizzle-orm";
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
  | { kind: "listTasks" }
  | { kind: "taskNotFound"; id: string }
  | { kind: "unsupported" }
  | { kind: "pushNotificationNotSupported" };

type HandlerOptions = {
  db: Db;
  getJwks?: (uri: string) => JWTVerifyGetKey;
  now?: () => Date;
  openai?: { apiKey: string; model: string; fetchImpl?: typeof fetch };
};

export type A2AHandler = (
  request: Request,
  customerId: string,
  pathSegments: string[],
) => Promise<Response>;

function response(body: unknown, status = 200, headers?: HeadersInit): Response {
  const response = Response.json(body, { status, ...(headers === undefined ? {} : { headers }) });
  response.headers.set("Content-Type", "application/a2a+json");
  return response;
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
  ) {
    return { kind: "agentCard" };
  }
  if (method === "POST" && path.length === 1 && path[0] === "message:send") {
    return { kind: "sendMessage" };
  }
  if (method === "POST" && path.length === 1 && path[0] === "message:stream") {
    return { kind: "unsupported" };
  }
  if (method === "GET" && path.length === 1 && path[0] === "tasks") {
    return { kind: "listTasks" };
  }
  if (path.length === 2 && path[0] === "tasks" && path[1]) {
    const subscribeId = path[1].match(/^(.+):subscribe$/)?.[1];
    if (subscribeId) {
      return method === "POST" ? { kind: "unsupported" } : null;
    }
    const cancelId = path[1].match(/^(.+):cancel$/)?.[1];
    if (cancelId) {
      return method === "POST" ? { kind: "taskNotFound", id: cancelId } : null;
    }
    if (method === "GET") {
      return { kind: "taskNotFound", id: path[1] };
    }
  }
  if (
    path.length === 3 &&
    path[0] === "tasks" &&
    path[1] &&
    path[2] === "pushNotificationConfigs" &&
    (method === "GET" || method === "POST")
  ) {
    return { kind: "pushNotificationNotSupported" };
  }
  if (
    path.length === 4 &&
    path[0] === "tasks" &&
    path[1] &&
    path[2] === "pushNotificationConfigs" &&
    path[3] &&
    (method === "GET" || method === "DELETE")
  ) {
    return { kind: "pushNotificationNotSupported" };
  }
  if (method === "GET" && path.length === 1 && path[0] === "extendedAgentCard") {
    return { kind: "unsupported" };
  }
  return null;
}

function invalidParams(message: string): HandlerError {
  return new HandlerError("INVALID_PARAMS", message);
}

function pageSize(url: URL): number {
  const values = url.searchParams.getAll("pageSize");
  if (values.length > 1) throw invalidParams("Invalid pageSize");
  const value = values[0];
  if (value === undefined) return 50;
  if (!/^\d+$/.test(value)) throw invalidParams("Invalid pageSize");
  const size = Number(value);
  if (!Number.isSafeInteger(size) || size < 1 || size > 100) {
    throw invalidParams("Invalid pageSize");
  }
  return size;
}

function makeAgentMessage(messageId: string, contextId: string, parts: unknown[]): Message {
  return MessageSchema.parse({
    messageId,
    contextId,
    role: "ROLE_AGENT",
    parts,
  });
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function textFromParts(parts: unknown[]): string {
  return parts
    .map((part) => {
      if (typeof part !== "object" || part === null || !("text" in part)) return "";
      return typeof part.text === "string" ? part.text : "";
    })
    .join("\n");
}

export function createA2AHandler(options: HandlerOptions): A2AHandler {
  return async (request, customerId, pathSegments) => {
    const route = matchRoute(request.method, pathSegments);
    if (!route) return notFound();

    if (route.kind === "agentCard") {
      try {
        const customer = await options.db.query.customers.findFirst({
          where: eq(customers.id, customerId),
        });
        if (!customer) return notFound();
        const card = buildAgentCard(customer, getProviderBaseUrl(request));
        return response(card, 200, {
          "Cache-Control": "public, max-age=300",
          "Access-Control-Allow-Origin": "*",
        });
      } catch (error) {
        console.error("A2A agent card request failed", error);
        return a2aError("INTERNAL", "Internal error");
      }
    }

    const defaultAudience = process.env.A2A_AUDIENCE;
    if (!defaultAudience) throw new Error("Set A2A_AUDIENCE");
    const auth = await verifyPlatformJwt({
      authorization: request.headers.get("authorization"),
      defaultAudience,
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

    let customer: typeof customers.$inferSelect | undefined;
    try {
      customer = await options.db.query.customers.findFirst({
        where: eq(customers.id, customerId),
      });
    } catch (error) {
      console.error("A2A customer lookup failed", error);
      return a2aError("INTERNAL", "Internal error");
    }
    if (!customer) return notFound();

    if (route.kind === "unsupported") {
      return a2aError("UNSUPPORTED_OPERATION", "Unsupported operation");
    }
    if (route.kind === "pushNotificationNotSupported") {
      return a2aError("PUSH_NOTIFICATION_NOT_SUPPORTED", "Push notifications are not supported");
    }
    if (route.kind === "taskNotFound") {
      return a2aError("TASK_NOT_FOUND", `Task not found: ${route.id}`);
    }
    if (route.kind === "listTasks") {
      try {
        return response(
          ListTasksResponseSchema.parse({
            tasks: [],
            nextPageToken: "",
            pageSize: pageSize(new URL(request.url)),
            totalSize: 0,
          }),
        );
      } catch (error) {
        if (error instanceof HandlerError) return a2aError(error.reason, error.message);
        console.error("A2A task list request failed", error);
        return a2aError("INTERNAL", "Internal error");
      }
    }

    try {
      let rawBody: unknown;
      try {
        rawBody = await request.json();
      } catch {
        throw invalidParams("Invalid JSON request body");
      }
      const parsed = SendMessageRequestSchema.safeParse(rawBody);
      if (!parsed.success) throw invalidParams("Invalid request body");

      const requestMessage = parsed.data.message;
      if (requestMessage.taskId !== undefined) {
        throw new HandlerError("TASK_NOT_FOUND", "Task not found");
      }
      if (requestMessage.role !== "ROLE_USER") {
        throw invalidParams("Message role must be ROLE_USER");
      }
      if (requestMessage.parts.some((part) => !("text" in part))) {
        throw new HandlerError("CONTENT_TYPE_NOT_SUPPORTED", "Content type not supported");
      }
      const text = requestMessage.parts.map((part) => ("text" in part ? part.text : "")).join("\n");
      if (!text.trim()) throw invalidParams("Message text must not be blank");

      const message = await options.db.transaction(async (tx) => {
        const transactionDb = tx as unknown as Db;
        let conversation: typeof conversations.$inferSelect;
        if (requestMessage.contextId !== undefined) {
          if (!isUuid(requestMessage.contextId)) throw invalidParams("Unknown contextId");
          const [existing] = await transactionDb
            .select()
            .from(conversations)
            .where(
              and(
                eq(conversations.id, requestMessage.contextId),
                eq(conversations.customerId, customer.id),
                eq(conversations.userId, auth.paUserId),
              ),
            )
            .for("update");
          if (!existing) throw invalidParams("Unknown contextId");
          conversation = existing;
        } else {
          const [created] = await transactionDb
            .insert(conversations)
            .values({
              id: randomUUID(),
              customerId: customer.id,
              userId: auth.paUserId,
              metadata: { flow: {} },
            })
            .returning();
          if (!created) throw new Error("Conversation insert returned no row");
          conversation = created;
        }

        const history = await transactionDb
          .select()
          .from(messages)
          .where(eq(messages.conversationId, conversation.id))
          .orderBy(asc(messages.createdAt), asc(messages.id));
        const duplicateIndex = history.findIndex(
          (stored) => stored.messageId === requestMessage.messageId && stored.role === "ROLE_USER",
        );
        if (duplicateIndex >= 0) {
          const reply = history[duplicateIndex + 1];
          if (!reply || reply.role !== "ROLE_AGENT") {
            throw invalidParams(
              "messageId was already received in this context and has no reply yet",
            );
          }
          return makeAgentMessage(reply.messageId, conversation.id, reply.parts);
        }
        if (history.some((stored) => stored.messageId === requestMessage.messageId)) {
          throw invalidParams("messageId is already in use in this context");
        }

        const lastMessage = history.at(-1);
        const timestamp = new Date(
          Math.max(
            options.now?.().getTime() ?? Date.now(),
            (lastMessage?.createdAt.getTime() ?? 0) + 1,
          ),
        );
        await transactionDb.insert(messages).values({
          conversationId: conversation.id,
          messageId: requestMessage.messageId,
          role: "ROLE_USER",
          parts: requestMessage.parts,
          createdAt: timestamp,
        });

        const turn = await runAgentTurn({
          customerName: customer.name,
          initialText: text,
          previousFlow: conversation.metadata.flow ?? {},
          history: history.flatMap<{ role: "customer" | "agent"; text: string }>((stored) => {
            if (stored.role === "ROLE_USER") {
              return [{ role: "customer" as const, text: textFromParts(stored.parts) }];
            }
            if (stored.role === "ROLE_AGENT") {
              return [{ role: "agent" as const, text: textFromParts(stored.parts) }];
            }
            return [];
          }),
          ...(options.openai ? { openai: options.openai } : {}),
        });
        const agentMessageId = randomUUID();
        const agentParts = [{ text: turn.text }];
        await transactionDb.insert(messages).values({
          conversationId: conversation.id,
          messageId: agentMessageId,
          role: "ROLE_AGENT",
          parts: agentParts,
          createdAt: new Date(timestamp.getTime() + 1),
        });
        await transactionDb
          .update(conversations)
          .set({
            metadata: { flow: turn.flow },
            updatedAt: new Date(timestamp.getTime() + 1),
          })
          .where(eq(conversations.id, conversation.id));

        return makeAgentMessage(agentMessageId, conversation.id, agentParts);
      });
      return response(SendMessageResponseSchema.parse({ message }));
    } catch (error) {
      if (error instanceof HandlerError) return a2aError(error.reason, error.message);
      if (
        error instanceof Error &&
        error.message.includes("messages_conversation_message_unique")
      ) {
        return a2aError("INVALID_PARAMS", "messageId is already in use in this context");
      }
      console.error("A2A request failed", error);
      return a2aError("INTERNAL", "Internal error");
    }
  };
}

import { cookies } from "next/headers";
import { runTurn } from "../../../lib/turn.js";
import type { TurnEvent } from "../../../lib/turnEvents.js";
import { USER_ID_COOKIE } from "../../../lib/session.js";

export const dynamic = "force-dynamic";

type TurnRequest = {
  providerUrl: string;
  customerIds: string[];
  conversationId: string;
  text: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTurnRequest(value: unknown): value is TurnRequest {
  return (
    isRecord(value) &&
    typeof value.providerUrl === "string" &&
    Array.isArray(value.customerIds) &&
    value.customerIds.every((customerId) => typeof customerId === "string") &&
    typeof value.conversationId === "string" &&
    typeof value.text === "string"
  );
}

export async function POST(request: Request): Promise<Response> {
  const body: unknown = await request.json().catch(() => undefined);
  if (!isTurnRequest(body)) {
    return Response.json({ error: "Invalid turn request" }, { status: 400 });
  }

  const userId = (await cookies()).get(USER_ID_COOKIE)?.value;
  if (!userId) return Response.json({ error: "Missing user ID" }, { status: 400 });
  const issuer = process.env.PA_ISSUER;
  const privateJwk = process.env.PA_PRIVATE_JWK;
  if (!issuer || !privateJwk) {
    return Response.json({ error: "PA signing credentials are not configured" }, { status: 500 });
  }

  const encoder = new TextEncoder();
  let disconnected = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (event: TurnEvent): void => {
        if (disconnected) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          disconnected = true;
        }
      };
      void runTurn(
        {
          connection: {
            providerUrl: body.providerUrl,
            customerIds: body.customerIds,
          },
          text: body.text,
          conversationId: body.conversationId,
          userId,
          issuer,
          privateJwk,
        },
        emit,
      )
        .catch((cause: unknown) => {
          emit({
            type: "error",
            message: cause instanceof Error ? cause.message : "Turn failed",
          });
        })
        .finally(() => {
          try {
            controller.close();
          } catch {
            disconnected = true;
          }
        });
    },
    cancel() {
      disconnected = true;
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}

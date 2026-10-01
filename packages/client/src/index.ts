import { randomUUID } from "node:crypto";
import {
  A2A_VERSION,
  A2AErrorResponseSchema,
  AgentCardSchema,
  SendMessageResponseSchema,
  type A2AErrorResponse,
  type AgentCard,
  type Message,
} from "@pact/protocol";

export type { AgentCard, Message };

type A2AStatus = A2AErrorResponse["error"]["status"];
type A2AErrorDetails = A2AErrorResponse["error"]["details"];

export class A2AError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly status: A2AStatus,
    readonly reason: string,
    message: string,
    readonly details: A2AErrorDetails,
  ) {
    super(message);
    this.name = "A2AError";
  }
}

export class A2AHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`A2A HTTP request failed with status ${status}`);
    this.name = "A2AHttpError";
  }
}

export async function fetchAgentCard(
  cardUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AgentCard> {
  const response = await fetchImpl(cardUrl);
  if (!response.ok) throw new A2AHttpError(response.status, await response.text());
  return AgentCardSchema.parse(await response.json());
}

export function interfaceUrl(card: AgentCard): string {
  const agentInterface = card.supportedInterfaces.find(
    (candidate) => candidate.protocolBinding === "HTTP+JSON" && candidate.protocolVersion === "1.0",
  );
  if (!agentInterface) throw new Error("Agent Card has no HTTP+JSON 1.0 interface");
  return agentInterface.url;
}

export class A2AClient {
  constructor(
    readonly options: {
      url: string;
      getToken: () => Promise<string> | string;
      fetchImpl?: typeof fetch;
    },
  ) {}

  private async request(path: string, body: unknown): Promise<Message> {
    const baseUrl = this.options.url.replace(/\/+$/, "");
    const url = new URL(`${baseUrl}${path}`);
    const token = await this.options.getToken();
    const response = await (this.options.fetchImpl ?? fetch)(url, {
      method: "POST",
      headers: {
        "A2A-Version": A2A_VERSION,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    let responseBody: unknown = text;
    if (text) {
      try {
        responseBody = JSON.parse(text) as unknown;
      } catch {
        responseBody = text;
      }
    }
    if (!response.ok) {
      const parsedError = A2AErrorResponseSchema.safeParse(responseBody);
      if (parsedError.success) {
        const error = parsedError.data.error;
        throw new A2AError(
          response.status,
          error.status,
          error.details[0]?.reason ?? "",
          error.message,
          error.details,
        );
      }
      throw new A2AHttpError(response.status, responseBody);
    }
    return SendMessageResponseSchema.parse(responseBody).message;
  }

  async sendMessage(text: string, options: { contextId?: string } = {}): Promise<Message> {
    return this.request("/message:send", {
      message: {
        messageId: randomUUID(),
        ...(options.contextId === undefined ? {} : { contextId: options.contextId }),
        role: "ROLE_USER",
        parts: [{ text, mediaType: "text/plain" }],
      },
    });
  }
}

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { importJWK, SignJWT, type JWK, type JWTPayload } from "jose";
import {
  A2A_VERSION,
  A2AErrorResponseSchema,
  AgentCardSchema,
  ContextCallbackSchema,
  ListContextMessagesResponseSchema,
  ListContextsResponseSchema,
  SendMessageResponseSchema,
  type A2AErrorResponse,
  type AgentCard,
  type ContextCallback,
  type ListContextMessagesResponse,
  type ListContextsResponse,
  type Message,
} from "@openpactprotocol/protocol";

export type {
  AgentCard,
  ContextCallback,
  ListContextMessagesResponse,
  ListContextsResponse,
  Message,
};

export interface PageOptions {
  pageSize?: number;
  pageToken?: string;
}

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

export interface PlatformSigner {
  readonly issuer: string;
  sign(input: { sub: string; aud: string; ttlSeconds?: number }): Promise<string>;
}

export function createPlatformSigner(input: {
  privateJwk: string | JWK;
  issuer: string;
}): PlatformSigner {
  const parsedJwk: JWK =
    typeof input.privateJwk === "string" ? (JSON.parse(input.privateJwk) as JWK) : input.privateJwk;
  const kid = typeof parsedJwk.kid === "string" ? parsedJwk.kid : undefined;
  if (!kid) throw new Error("Private JWK must include kid");
  const privateKey = importJWK(parsedJwk, "ES256");
  return {
    issuer: input.issuer,
    async sign({ sub, aud, ttlSeconds = 120 }) {
      if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0 || ttlSeconds > 300) {
        throw new Error("ttlSeconds must be an integer between 1 and 300");
      }
      const key = await privateKey;
      const iat = Math.floor(Date.now() / 1000);
      return new SignJWT({ sub } satisfies JWTPayload)
        .setProtectedHeader({ alg: "ES256", kid, typ: "JWT" })
        .setIssuer(input.issuer)
        .setAudience(aud)
        .setIssuedAt(iat)
        .setExpirationTime(iat + ttlSeconds)
        .setJti(randomUUID())
        .sign(key);
    },
  };
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

  private async request(path: string, body?: unknown): Promise<unknown> {
    const baseUrl = this.options.url.replace(/\/+$/, "");
    const url = new URL(`${baseUrl}${path}`);
    const token = await this.options.getToken();
    const response = await (this.options.fetchImpl ?? fetch)(
      url,
      body === undefined
        ? {
            method: "GET",
            headers: { "A2A-Version": A2A_VERSION, Authorization: `Bearer ${token}` },
          }
        : {
            method: "POST",
            headers: {
              "A2A-Version": A2A_VERSION,
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
          },
    );
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
    return responseBody;
  }

  async sendMessage(text: string, options: { contextId?: string } = {}): Promise<Message> {
    const response = await this.request("/message:send", {
      message: {
        messageId: randomUUID(),
        ...(options.contextId === undefined ? {} : { contextId: options.contextId }),
        role: "ROLE_USER",
        parts: [{ text, mediaType: "text/plain" }],
      },
    });
    return SendMessageResponseSchema.parse(response).message;
  }

  async listContexts(options: PageOptions = {}): Promise<ListContextsResponse> {
    return ListContextsResponseSchema.parse(await this.request(`/contexts${pageQuery(options)}`));
  }

  async listContextMessages(
    contextId: string,
    options: PageOptions = {},
  ): Promise<ListContextMessagesResponse> {
    const path = `/contexts/${encodeURIComponent(contextId)}/messages${pageQuery(options)}`;
    return ListContextMessagesResponseSchema.parse(await this.request(path));
  }
}

function pageQuery({ pageSize, pageToken }: PageOptions): string {
  const query = new URLSearchParams();
  if (pageSize !== undefined) query.set("pageSize", String(pageSize));
  if (pageToken) query.set("pageToken", pageToken);
  const encoded = query.toString();
  return encoded ? `?${encoded}` : "";
}

export function verifyContextCallback(input: {
  body: string | Uint8Array;
  signature: string | null;
  secret: string;
}): ContextCallback {
  const expected = Buffer.from(
    `sha256=${createHmac("sha256", input.secret).update(input.body).digest("hex")}`,
  );
  const received = Buffer.from(input.signature ?? "");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    throw new Error("Invalid X-A2A-Signature");
  }
  const text = typeof input.body === "string" ? input.body : new TextDecoder().decode(input.body);
  return ContextCallbackSchema.parse(JSON.parse(text));
}

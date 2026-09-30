import { randomUUID } from "node:crypto";
import { importJWK, SignJWT, type JWK, type JWTPayload } from "jose";
import {
  A2A_VERSION,
  A2AErrorResponseSchema,
  AgentCardSchema,
  CancelTaskRequestSchema,
  ListTasksResponseSchema,
  PlatformRegistrationResponseSchema,
  SendMessageResponseSchema,
  TaskSchema,
  type A2AErrorResponse,
  type AgentCard,
  type ListTasksResponse,
  type Message,
  type PlatformRegistrationRequest,
  type RegisteredPlatform,
  type Task,
} from "@pap/protocol";

export type { AgentCard, ListTasksResponse, Message, Task };
export type { PlatformRegistrationRequest, RegisteredPlatform };

export type DiscoveredAgent = {
  card: AgentCard;
  url: string;
};

export type SendMessageResult = {
  task: Task;
};

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

export type RegisterPlatformResult = {
  created: boolean;
  platform: RegisteredPlatform;
};

export class PlatformRegistrationError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "PlatformRegistrationError";
  }
}

export async function registerPlatform(input: {
  providerUrl: string;
  name: string;
  jwksUri?: string;
  signer: PlatformSigner;
}): Promise<RegisterPlatformResult> {
  const endpoint = `${input.providerUrl.replace(/\/+$/, "")}/api/platforms`;
  const jwksUri = input.jwksUri ?? `${input.signer.issuer}/.well-known/jwks.json`;
  const token = await input.signer.sign({ sub: input.signer.issuer, aud: endpoint });
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: input.name, jwksUri } satisfies PlatformRegistrationRequest),
  });
  const text = await response.text();
  let body: unknown = text;
  if (text) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = text;
    }
  }
  if (!response.ok) {
    const message =
      response.status === 401
        ? "Unauthorized"
        : typeof body === "object" &&
            body !== null &&
            "error" in body &&
            typeof body.error === "string"
          ? body.error
          : "Platform registration failed";
    throw new PlatformRegistrationError(response.status, message);
  }

  const parsed = PlatformRegistrationResponseSchema.parse(body);
  return { created: response.status === 201, platform: parsed.platform };
}

export async function discoverAgent(providerUrl: string, slug: string): Promise<DiscoveredAgent> {
  const base = providerUrl.replace(/\/+$/, "");
  const result = await fetch(`${base}/a2a/${encodeURIComponent(slug)}/.well-known/agent-card.json`);
  if (!result.ok) throw new A2AHttpError(result.status, await result.text());
  const card = AgentCardSchema.parse(await result.json());
  const agentInterface = card.supportedInterfaces.find(
    (candidate) => candidate.protocolBinding === "HTTP+JSON" && candidate.protocolVersion === "1.0",
  );
  if (!agentInterface) throw new Error("Agent does not expose an HTTP+JSON 1.0 interface");
  return { card, url: agentInterface.url };
}

type QueryValue = string | number | boolean | undefined;

export class A2AClient {
  constructor(
    readonly options: {
      url: string;
      signer: PlatformSigner;
      userId: string;
      fetchImpl?: typeof fetch;
    },
  ) {}

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    options: { query?: Record<string, QueryValue>; body?: unknown } = {},
  ): Promise<T> {
    const baseUrl = this.options.url.replace(/\/+$/, "");
    const url = new URL(`${baseUrl}${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const token = await this.options.signer.sign({ sub: this.options.userId, aud: baseUrl });
    const response = await (this.options.fetchImpl ?? fetch)(url, {
      method,
      headers: {
        "A2A-Version": A2A_VERSION,
        Authorization: `Bearer ${token}`,
        ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    const text = await response.text();
    let body: unknown = text;
    if (text) {
      try {
        body = JSON.parse(text) as unknown;
      } catch {
        body = text;
      }
    }
    if (!response.ok) {
      const parsedError = A2AErrorResponseSchema.safeParse(body);
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
      throw new A2AHttpError(response.status, body);
    }
    return body as T;
  }

  async sendMessage(
    text: string,
    options: { taskId?: string; contextId?: string; historyLength?: number } = {},
  ): Promise<SendMessageResult> {
    const body = await this.request<unknown>("POST", "/message:send", {
      body: {
        message: {
          messageId: randomUUID(),
          ...(options.taskId ? { taskId: options.taskId } : {}),
          ...(options.contextId === undefined ? {} : { contextId: options.contextId }),
          role: "ROLE_USER",
          parts: [{ text, mediaType: "text/plain" }],
        },
        ...(options.historyLength === undefined
          ? {}
          : { configuration: { historyLength: options.historyLength } }),
      },
    });
    const parsed = SendMessageResponseSchema.parse(body);
    if (!("task" in parsed)) throw new Error("Expected SendMessage to return a task");
    return { task: parsed.task };
  }

  async getTask(id: string, historyLength?: number): Promise<Task> {
    return TaskSchema.parse(
      await this.request("GET", `/tasks/${encodeURIComponent(id)}`, {
        query: { historyLength },
      }),
    );
  }

  async listTasks(
    options: {
      contextId?: string;
      status?: string;
      pageSize?: number;
      pageToken?: string;
      historyLength?: number;
      statusTimestampAfter?: string;
      includeArtifacts?: boolean;
    } = {},
  ): Promise<ListTasksResponse> {
    return ListTasksResponseSchema.parse(await this.request("GET", "/tasks", { query: options }));
  }

  async cancelTask(id: string): Promise<Task> {
    const parsedBody = CancelTaskRequestSchema.parse({ id });
    return TaskSchema.parse(
      await this.request("POST", `/tasks/${encodeURIComponent(id)}:cancel`, {
        body: parsedBody,
      }),
    );
  }
}

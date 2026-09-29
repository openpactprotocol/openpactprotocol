import { randomUUID } from "node:crypto";
import { importJWK, SignJWT, type JWTPayload } from "jose";
import { AgentCardSchema, type AgentCard } from "@pap/protocol";
import type { ListTasksResponse, Task } from "@pap/protocol";

type PrivateJwk = Parameters<typeof importJWK>[0];

export class A2ARpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data: unknown,
  ) {
    super(message);
    this.name = "A2ARpcError";
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
  sign(input: { sub: string; aud: string; ttlSeconds?: number }): Promise<string>;
}

export function createPlatformSigner(input: {
  privateJwk: string | PrivateJwk;
  issuer: string;
}): PlatformSigner {
  const parsedJwk: PrivateJwk =
    typeof input.privateJwk === "string"
      ? (JSON.parse(input.privateJwk) as PrivateJwk)
      : input.privateJwk;
  const kid = typeof parsedJwk.kid === "string" ? parsedJwk.kid : undefined;
  if (!kid) throw new Error("Private JWK must include kid");
  const privateKey = importJWK(parsedJwk, "ES256");
  return {
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

export async function discoverAgent(
  providerUrl: string,
  slug: string,
): Promise<{ card: AgentCard; url: string }> {
  const base = providerUrl.replace(/\/+$/, "");
  const result = await fetch(`${base}/a2a/${encodeURIComponent(slug)}/.well-known/agent-card.json`);
  if (!result.ok) throw new A2AHttpError(result.status, await result.text());
  const card = AgentCardSchema.parse(await result.json());
  const agentInterface = card.supportedInterfaces.find(
    (candidate) => candidate.protocolBinding === "JSONRPC" && candidate.protocolVersion === "1.0",
  );
  if (!agentInterface) throw new Error("Agent does not expose a JSONRPC 1.0 interface");
  return { card, url: agentInterface.url };
}

export interface RpcOptions {
  token?: string;
  headers?: HeadersInit;
}

export class A2AClient {
  constructor(
    readonly options: {
      url: string;
      signer: PlatformSigner;
      userId: string;
      fetchImpl?: typeof fetch;
    },
  ) {}

  async rpc<T = unknown>(
    method: string,
    params: unknown = {},
    options: RpcOptions = {},
  ): Promise<T> {
    const token =
      options.token ??
      (await this.options.signer.sign({ sub: this.options.userId, aud: this.options.url }));
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const result = await fetchImpl(this.options.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "A2A-Version": "1.0",
        Authorization: `Bearer ${token}`,
        ...options.headers,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: randomUUID(), method, params }),
    });
    const body: unknown = await result.json().catch(async () => await result.text());
    if (!result.ok) throw new A2AHttpError(result.status, body);
    if (typeof body === "object" && body !== null && "error" in body) {
      const error = body.error;
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        typeof error.code === "number" &&
        "message" in error &&
        typeof error.message === "string"
      ) {
        throw new A2ARpcError(error.code, error.message, "data" in error ? error.data : undefined);
      }
    }
    if (typeof body === "object" && body !== null && "result" in body) return body.result as T;
    throw new Error("Invalid JSON-RPC response");
  }

  async sendMessage(
    text: string,
    options: { taskId?: string; contextId?: string; historyLength?: number } = {},
  ): Promise<{ task: Task }> {
    return this.rpc("SendMessage", {
      message: {
        messageId: randomUUID(),
        ...(options.taskId ? { taskId: options.taskId } : {}),
        ...(options.contextId ? { contextId: options.contextId } : {}),
        role: "ROLE_USER",
        parts: [{ text, mediaType: "text/plain" }],
      },
      ...(options.historyLength === undefined
        ? {}
        : { configuration: { historyLength: options.historyLength } }),
    });
  }

  getTask(id: string, historyLength?: number): Promise<Task> {
    return this.rpc("GetTask", { id, ...(historyLength === undefined ? {} : { historyLength }) });
  }

  listTasks(
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
    return this.rpc("ListTasks", options);
  }

  cancelTask(id: string): Promise<unknown> {
    return this.rpc("CancelTask", { id });
  }
}

import { randomUUID } from "node:crypto";
import { compactVerify, createRemoteJWKSet, type CompactVerifyGetKey } from "jose";
import { A2A_VERSION, A2AErrorResponseSchema, type AgentCard } from "@openpactprotocol/protocol";
import {
  AuthorizationServerMetadataSchema,
  DELEGATION_HEADER,
  DEVICE_CODE_GRANT_TYPE,
  DelegatedSendMessageResponseSchema,
  DeviceAuthorizationResponseSchema,
  OAuth2DeviceCodeSecuritySchemeSchema,
  OAuthErrorResponseSchema,
  PACT_METADATA,
  REFRESH_TOKEN_GRANT_TYPE,
  ReceiptClaimsSchema,
  ReceiptSchema,
  StepUpMetadataSchema,
  TokenResponseSchema,
  formatScope,
  parseScope,
  type AuthorizationServerMetadata,
  type Receipt,
  type ReceiptClaims,
  type Task,
  type TokenResponse,
} from "@openpactprotocol/protocol/delegation";
import { A2AError, A2AHttpError, type Message } from "./index.js";

// PACT Delegated profile (spec §5), personal-agent side. Identity-only
// integrations need only ./index.ts.

export type { AuthorizationServerMetadata, Receipt, ReceiptClaims, Task };

export interface DelegationScheme {
  identitySchemeName: string;
  delegationSchemeName: string;
  deviceAuthorizationUrl: string;
  tokenUrl: string;
  refreshUrl: string;
  metadataUrl: string;
  scopes: { id: string; description: string }[];
}

export function delegationScheme(card: AgentCard): DelegationScheme | undefined {
  const schemes = card.securitySchemes ?? {};
  for (const requirement of card.securityRequirements ?? []) {
    const names = Object.keys(requirement.schemes);
    if (names.length !== 2) continue;
    let identitySchemeName: string | undefined;
    let delegation: { name: string; scheme: ReturnType<typeof parseDelegationScheme> } | undefined;
    for (const name of names) {
      const scheme = schemes[name];
      if (!scheme) continue;
      if (
        "httpAuthSecurityScheme" in scheme &&
        scheme.httpAuthSecurityScheme.scheme.toLowerCase() === "bearer"
      ) {
        identitySchemeName = name;
        continue;
      }
      const parsed = parseDelegationScheme(scheme);
      if (parsed) delegation = { name, scheme: parsed };
    }
    if (!identitySchemeName || !delegation?.scheme) continue;
    const { flows, oauth2MetadataUrl } = delegation.scheme;
    return {
      identitySchemeName,
      delegationSchemeName: delegation.name,
      deviceAuthorizationUrl: flows.deviceCode.deviceAuthorizationUrl,
      tokenUrl: flows.deviceCode.tokenUrl,
      refreshUrl: flows.deviceCode.refreshUrl ?? flows.deviceCode.tokenUrl,
      metadataUrl: oauth2MetadataUrl,
      scopes: Object.entries(flows.deviceCode.scopes).map(([id, description]) => ({
        id,
        description,
      })),
    };
  }
  return undefined;
}

function parseDelegationScheme(scheme: unknown) {
  const parsed = OAuth2DeviceCodeSecuritySchemeSchema.safeParse(scheme);
  return parsed.success ? parsed.data.oauth2SecurityScheme : undefined;
}

export async function fetchAuthorizationServerMetadata(
  metadataUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AuthorizationServerMetadata> {
  const response = await fetchImpl(metadataUrl, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new A2AHttpError(response.status, await response.text());
  return AuthorizationServerMetadataSchema.parse(await response.json());
}

export class OAuthError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly error: string,
    readonly description: string | undefined,
  ) {
    super(description ? `${error}: ${description}` : error);
    this.name = "OAuthError";
  }
}

export interface DeviceAuthorization {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresAt: number;
  intervalSeconds: number;
}

export interface DelegationToken {
  accessToken: string;
  refreshToken?: string;
  scopes: string[];
  expiresAt: number;
}

export type DevicePollResult =
  | { status: "pending" }
  | { status: "slow_down" }
  | { status: "granted"; token: DelegationToken };

type GetToken = () => Promise<string> | string;

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return text;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

const defaultSleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });

export class DeviceCodeClient {
  constructor(
    readonly options: {
      scheme: Pick<
        DelegationScheme,
        "deviceAuthorizationUrl" | "tokenUrl" | "refreshUrl" | "scopes"
      >;
      clientId: string;
      getToken: GetToken;
      fetchImpl?: typeof fetch;
      sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
      now?: () => number;
    },
  ) {}

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private async postForm(url: string, params: Record<string, string>): Promise<unknown> {
    const token = await this.options.getToken();
    const response = await (this.options.fetchImpl ?? fetch)(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ ...params, client_id: this.options.clientId }).toString(),
    });
    const body = await readBody(response);
    if (response.ok) return body;
    const oauthError = OAuthErrorResponseSchema.safeParse(body);
    if (response.status !== 401 && oauthError.success) {
      throw new OAuthError(
        response.status,
        oauthError.data.error,
        oauthError.data.error_description,
      );
    }
    throw new A2AHttpError(response.status, body);
  }

  private toToken(response: TokenResponse): DelegationToken {
    return {
      accessToken: response.access_token,
      ...(response.refresh_token === undefined ? {} : { refreshToken: response.refresh_token }),
      scopes: parseScope(response.scope),
      expiresAt: this.now() + response.expires_in * 1000,
    };
  }

  async start(scopes: readonly string[]): Promise<DeviceAuthorization> {
    const known = new Set(this.options.scheme.scopes.map((scope) => scope.id));
    const unknown = scopes.filter((scope) => !known.has(scope));
    if (scopes.length === 0) throw new Error("Request at least one scope");
    if (unknown.length > 0) throw new Error(`Scopes not on the Agent Card: ${unknown.join(", ")}`);
    const response = DeviceAuthorizationResponseSchema.parse(
      await this.postForm(this.options.scheme.deviceAuthorizationUrl, {
        scope: formatScope(scopes),
      }),
    );
    return {
      deviceCode: response.device_code,
      userCode: response.user_code,
      verificationUri: response.verification_uri,
      verificationUriComplete: response.verification_uri_complete,
      expiresAt: this.now() + response.expires_in * 1000,
      intervalSeconds: response.interval ?? 5,
    };
  }

  async poll(deviceCode: string): Promise<DevicePollResult> {
    try {
      const response = TokenResponseSchema.parse(
        await this.postForm(this.options.scheme.tokenUrl, {
          grant_type: DEVICE_CODE_GRANT_TYPE,
          device_code: deviceCode,
        }),
      );
      return { status: "granted", token: this.toToken(response) };
    } catch (error) {
      if (error instanceof OAuthError && error.error === "authorization_pending") {
        return { status: "pending" };
      }
      if (error instanceof OAuthError && error.error === "slow_down")
        return { status: "slow_down" };
      throw error;
    }
  }

  async waitForToken(
    authorization: DeviceAuthorization,
    options: { signal?: AbortSignal } = {},
  ): Promise<DelegationToken> {
    const sleep = this.options.sleep ?? defaultSleep;
    let intervalSeconds = authorization.intervalSeconds;
    while (this.now() + intervalSeconds * 1000 <= authorization.expiresAt) {
      await sleep(intervalSeconds * 1000, options.signal);
      const result = await this.poll(authorization.deviceCode);
      if (result.status === "granted") return result.token;
      // RFC 8628 §3.5: add 5 seconds on slow_down.
      if (result.status === "slow_down") intervalSeconds += 5;
    }
    throw new OAuthError(400, "expired_token", "The device code expired before approval");
  }

  async refresh(refreshToken: string): Promise<DelegationToken> {
    const response = TokenResponseSchema.parse(
      await this.postForm(this.options.scheme.refreshUrl, {
        grant_type: REFRESH_TOKEN_GRANT_TYPE,
        refresh_token: refreshToken,
      }),
    );
    return this.toToken(response);
  }
}

export class DelegationTokenRejectedError extends A2AHttpError {
  constructor(status: number, body: unknown) {
    super(status, body);
    this.name = "DelegationTokenRejectedError";
  }
}

export type DelegatedSendResult =
  | { kind: "message"; message: Message; receipt?: Receipt }
  | {
      kind: "authRequired";
      task: Task;
      missingScopes: string[];
      verificationUriComplete?: string;
    };

export class DelegatedA2AClient {
  constructor(
    readonly options: {
      url: string;
      getToken: GetToken;
      getDelegationToken?: () => Promise<string | undefined> | string | undefined;
      fetchImpl?: typeof fetch;
    },
  ) {}

  async send(
    text: string,
    options: { contextId?: string; messageId?: string } = {},
  ): Promise<DelegatedSendResult> {
    const url = new URL(`${this.options.url.replace(/\/+$/, "")}/message:send`);
    const token = await this.options.getToken();
    const delegationToken = await this.options.getDelegationToken?.();
    const response = await (this.options.fetchImpl ?? fetch)(url, {
      method: "POST",
      headers: {
        "A2A-Version": A2A_VERSION,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(delegationToken ? { [DELEGATION_HEADER]: `Bearer ${delegationToken}` } : {}),
      },
      body: JSON.stringify({
        message: {
          messageId: options.messageId ?? randomUUID(),
          ...(options.contextId === undefined ? {} : { contextId: options.contextId }),
          role: "ROLE_USER",
          parts: [{ text, mediaType: "text/plain" }],
        },
      }),
    });
    const body = await readBody(response);
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
      if (
        response.status === 401 &&
        delegationToken &&
        /error="invalid_token"/.test(response.headers.get("www-authenticate") ?? "")
      ) {
        throw new DelegationTokenRejectedError(response.status, body);
      }
      throw new A2AHttpError(response.status, body);
    }

    const parsed = DelegatedSendMessageResponseSchema.parse(body);
    if ("task" in parsed) {
      if (parsed.task.status.state !== "TASK_STATE_AUTH_REQUIRED") {
        throw new Error(`Unexpected task state ${parsed.task.status.state}`);
      }
      const metadata = StepUpMetadataSchema.parse(parsed.task.metadata ?? {});
      const link = metadata[PACT_METADATA.verificationUriComplete];
      return {
        kind: "authRequired",
        task: parsed.task,
        missingScopes: metadata[PACT_METADATA.missingScopes],
        ...(link === undefined ? {} : { verificationUriComplete: link }),
      };
    }
    const rawReceipt = parsed.message.metadata?.[PACT_METADATA.receipt];
    return {
      kind: "message",
      message: parsed.message,
      ...(rawReceipt === undefined ? {} : { receipt: ReceiptSchema.parse(rawReceipt) }),
    };
  }
}

export class ReceiptVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReceiptVerificationError";
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

const remoteJwks = new Map<string, CompactVerifyGetKey>();

export async function verifyReceipt(
  receipt: Receipt,
  options: {
    jwks: string | CompactVerifyGetKey;
    expected?: Partial<Pick<ReceiptClaims, "grantId" | "user" | "pa" | "brand">>;
  },
): Promise<ReceiptClaims> {
  let getKey = typeof options.jwks === "string" ? remoteJwks.get(options.jwks) : options.jwks;
  if (!getKey && typeof options.jwks === "string") {
    getKey = createRemoteJWKSet(new URL(options.jwks));
    remoteJwks.set(options.jwks, getKey);
  }
  if (!getKey) throw new Error("No JWKS for receipt verification");
  let payload: unknown;
  try {
    const verified = await compactVerify(receipt.jws, getKey, { algorithms: ["ES256", "RS256"] });
    payload = JSON.parse(new TextDecoder().decode(verified.payload)) as unknown;
  } catch (error) {
    throw new ReceiptVerificationError(
      `Receipt signature is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const claims = ReceiptClaimsSchema.safeParse(payload);
  if (!claims.success) throw new ReceiptVerificationError("Receipt payload has invalid claims");
  if (canonicalJson(claims.data) !== canonicalJson(receipt.claims)) {
    throw new ReceiptVerificationError("Receipt claims do not match the signed payload");
  }
  for (const [key, value] of Object.entries(options.expected ?? {})) {
    if (value !== undefined && claims.data[key as keyof ReceiptClaims] !== value) {
      throw new ReceiptVerificationError(`Receipt ${key} does not match`);
    }
  }
  return claims.data;
}

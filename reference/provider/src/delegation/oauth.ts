import { randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { jwtVerify, type JWTVerifyGetKey } from "jose";
import { ulid } from "ulid";
import {
  DEVICE_CODE_GRANT_TYPE,
  REFRESH_TOKEN_GRANT_TYPE,
  formatScope,
  parseScope,
  type DeviceAuthorizationResponse,
  type TokenResponse,
} from "@openpactprotocol/protocol/delegation";
import { getProviderBaseUrl } from "../a2a/providerBaseUrl.js";
import { getRemoteJwks, verifyPlatformJwt } from "../auth/verifyPlatformJwt.js";
import type { Db } from "../db/client.js";
import {
  agentPlatforms,
  customers,
  delegationGrants,
  deviceAuthorizations,
  refreshTokens,
  usedBrandAssertions,
} from "../db/schema.js";
import {
  delegationConfig,
  delegationEnabled,
  delegationUrls,
  type DelegationConfig,
} from "./config.js";
import { getSigningKey } from "./keys.js";
import { consentPage, errorPage } from "./pages.js";
import {
  randomToken,
  sha256,
  signConsentSession,
  signDelegationToken,
  verifyConsentSession,
} from "./tokens.js";

const DEVICE_CODE_TTL_SECONDS = 600;
const POLL_INTERVAL_SECONDS = 3;
const ACCESS_TOKEN_TTL_SECONDS = 3600;
const GRANT_TTL_MS = 30 * 24 * 3600 * 1000;
const USER_CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ";

type OAuthOptions = {
  db: Db;
  getJwks?: (uri: string) => JWTVerifyGetKey;
  now?: () => Date;
};

type Urls = ReturnType<typeof delegationUrls>;

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", Pragma: "no-cache" },
  });
}

function oauthError(error: string, description: string, status = 400): Response {
  return json({ error, error_description: description }, status);
}

function userCode(): string {
  const bytes = randomBytes(8);
  const chars = [...bytes].map((byte) => USER_CODE_ALPHABET[byte % USER_CODE_ALPHABET.length]);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}

export function verificationUris(
  config: DelegationConfig,
  urls: Urls,
  code: string,
): { verification_uri: string; verification_uri_complete: string } {
  const login = (returnTo: string) =>
    `${config.brandUrl}/login?${new URLSearchParams({ return_to: returnTo })}`;
  return {
    verification_uri: login(urls.consent),
    verification_uri_complete: login(`${urls.consent}?${new URLSearchParams({ user_code: code })}`),
  };
}

export async function createDeviceAuthorization(
  db: Db,
  input: {
    config: DelegationConfig;
    urls: Urls;
    customerId: string;
    platformId: string;
    clientId: string;
    scopes: string[];
    now: Date;
  },
): Promise<DeviceAuthorizationResponse> {
  const deviceCode = randomToken("dc_");
  const code = userCode();
  await db.insert(deviceAuthorizations).values({
    customerId: input.customerId,
    platformId: input.platformId,
    clientId: input.clientId,
    deviceCodeHash: sha256(deviceCode),
    userCode: code,
    requestedScope: formatScope(input.scopes),
    intervalSeconds: POLL_INTERVAL_SECONDS,
    expiresAt: new Date(input.now.getTime() + DEVICE_CODE_TTL_SECONDS * 1000),
  });
  return {
    device_code: deviceCode,
    user_code: code,
    ...verificationUris(input.config, input.urls, code),
    expires_in: DEVICE_CODE_TTL_SECONDS,
    interval: POLL_INTERVAL_SECONDS,
  };
}

async function issueTokens(
  db: Db,
  grant: typeof delegationGrants.$inferSelect,
  urls: Urls,
  now: Date,
): Promise<TokenResponse> {
  const accessToken = await signDelegationToken(
    {
      iss: urls.issuer,
      aud: urls.interfaceUrl,
      sub: grant.brandUserId,
      client_id: grant.clientId,
      scope: grant.scope,
      grant_id: grant.id,
    },
    { now, ttlSeconds: ACCESS_TOKEN_TTL_SECONDS },
  );
  const refreshToken = randomToken("rt_");
  await db.insert(refreshTokens).values({
    tokenHash: sha256(refreshToken),
    grantId: grant.id,
    expiresAt: grant.expiresAt,
  });
  return {
    token_type: "Bearer",
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    scope: grant.scope,
  };
}

// Authorization server for one Brand (spec §5.3): RFC 8414 metadata, JWKS,
// RFC 8628 device authorization and token endpoints, and the consent step the
// Brand's login returns to.
export function createOAuthHandler(options: OAuthOptions) {
  const getJwks = options.getJwks ?? getRemoteJwks;
  const now = () => options.now?.() ?? new Date();

  return async (request: Request, customerId: string, path: string[]): Promise<Response> => {
    // The signing key is Provider-wide, so JWKS needs no database lookup. Brand
    // APIs fetch it while an A2A turn holds a database connection.
    if (request.method === "GET" && path.join("/") === "jwks.json" && delegationEnabled()) {
      const key = await getSigningKey();
      return Response.json(key.jwks, {
        headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300" },
      });
    }
    const customer = await options.db.query.customers.findFirst({
      where: eq(customers.id, customerId),
    });
    const config = customer ? delegationConfig(customer.name) : undefined;
    if (!customer || !config) return new Response(null, { status: 404 });
    const urls = delegationUrls(getProviderBaseUrl(request), customer.id);
    const route = `${request.method} ${path.join("/")}`;

    if (route === "GET .well-known/oauth-authorization-server") {
      return Response.json(
        {
          issuer: urls.issuer,
          device_authorization_endpoint: urls.deviceAuthorization,
          token_endpoint: urls.token,
          jwks_uri: urls.jwks,
          scopes_supported: config.scopes.map((scope) => scope.id),
          grant_types_supported: [DEVICE_CODE_GRANT_TYPE, REFRESH_TOKEN_GRANT_TYPE],
          token_endpoint_auth_methods_supported: ["private_key_jwt"],
        },
        { headers: { "Access-Control-Allow-Origin": "*" } },
      );
    }
    if (route === "POST device_authorization" || route === "POST token") {
      return clientEndpoint(request, route, customer.id, config, urls);
    }
    if (route === "POST consent") return consent(request, customer, config, urls);
    if (route === "POST consent/decision") return decision(request, customer, config, urls);
    return new Response(null, { status: 404 });
  };

  // Endpoints the personal agent calls, authenticated with its §3 JWT.
  async function clientEndpoint(
    request: Request,
    route: string,
    customerId: string,
    config: DelegationConfig,
    urls: Urls,
  ): Promise<Response> {
    const defaultAudience = process.env.A2A_AUDIENCE;
    if (!defaultAudience) throw new Error("Set A2A_AUDIENCE");
    const auth = await verifyPlatformJwt({
      authorization: request.headers.get("authorization"),
      defaultAudience,
      db: options.db,
      getJwks,
      now,
    });
    if (!auth) {
      return new Response(null, {
        status: 401,
        headers: { "WWW-Authenticate": 'Bearer realm="a2a"' },
      });
    }
    const form = new URLSearchParams(await request.text());
    if (form.get("client_id") !== auth.issuer) {
      return oauthError("invalid_client", "client_id must equal the personal-agent issuer", 401);
    }
    const at = now();

    if (route === "POST device_authorization") {
      const scopes = parseScope(form.get("scope") ?? "");
      const known = new Set(config.scopes.map((scope) => scope.id));
      if (scopes.length === 0 || scopes.some((scope) => !known.has(scope))) {
        return oauthError("invalid_scope", "Request scope ids listed on the Agent Card");
      }
      return json(
        await createDeviceAuthorization(options.db, {
          config,
          urls,
          customerId,
          platformId: auth.platform.id,
          clientId: auth.issuer,
          scopes,
          now: at,
        }),
      );
    }

    const grantType = form.get("grant_type");
    if (grantType === DEVICE_CODE_GRANT_TYPE) {
      const deviceCode = form.get("device_code") ?? "";
      const row = await options.db.query.deviceAuthorizations.findFirst({
        where: and(
          eq(deviceAuthorizations.deviceCodeHash, sha256(deviceCode)),
          eq(deviceAuthorizations.customerId, customerId),
        ),
      });
      if (!row || row.clientId !== auth.issuer) {
        return oauthError("invalid_grant", "Unknown device_code");
      }
      if (row.expiresAt <= at) return oauthError("expired_token", "The device code expired");
      if (row.status === "denied") return oauthError("access_denied", "The user denied access");
      if (row.status === "consumed") return oauthError("invalid_grant", "device_code was used");
      if (row.status === "pending") {
        const tooSoon =
          row.lastPolledAt !== null &&
          at.getTime() - row.lastPolledAt.getTime() < row.intervalSeconds * 1000;
        await options.db
          .update(deviceAuthorizations)
          .set({ lastPolledAt: at })
          .where(eq(deviceAuthorizations.id, row.id));
        return tooSoon
          ? oauthError("slow_down", "Poll less often")
          : oauthError("authorization_pending", "Waiting for the user");
      }
      const [consumed] = await options.db
        .update(deviceAuthorizations)
        .set({ status: "consumed" })
        .where(
          and(eq(deviceAuthorizations.id, row.id), eq(deviceAuthorizations.status, "approved")),
        )
        .returning();
      const grant =
        consumed?.grantId &&
        (await options.db.query.delegationGrants.findFirst({
          where: eq(delegationGrants.id, consumed.grantId),
        }));
      if (!grant) return oauthError("invalid_grant", "device_code was used");
      return json(await issueTokens(options.db, grant, urls, at));
    }

    if (grantType === REFRESH_TOKEN_GRANT_TYPE) {
      const [used] = await options.db
        .update(refreshTokens)
        .set({ usedAt: at })
        .where(
          and(
            eq(refreshTokens.tokenHash, sha256(form.get("refresh_token") ?? "")),
            isNull(refreshTokens.usedAt),
            gt(refreshTokens.expiresAt, at),
          ),
        )
        .returning();
      const grant =
        used &&
        (await options.db.query.delegationGrants.findFirst({
          where: and(
            eq(delegationGrants.id, used.grantId),
            eq(delegationGrants.customerId, customerId),
            eq(delegationGrants.clientId, auth.issuer),
            isNull(delegationGrants.revokedAt),
            gt(delegationGrants.expiresAt, at),
          ),
        }));
      if (!grant) return oauthError("invalid_grant", "Unknown or expired refresh_token");
      return json(await issueTokens(options.db, grant, urls, at));
    }

    return oauthError("unsupported_grant_type", "Unsupported grant_type");
  }

  async function pendingAuthorization(customerId: string, code: string) {
    const row = await options.db.query.deviceAuthorizations.findFirst({
      where: and(
        eq(deviceAuthorizations.userCode, code),
        eq(deviceAuthorizations.customerId, customerId),
      ),
    });
    if (!row || row.status !== "pending" || row.expiresAt <= now()) return undefined;
    const platform = await options.db.query.agentPlatforms.findFirst({
      where: eq(agentPlatforms.id, row.platformId),
    });
    return platform ? { row, platform } : undefined;
  }

  // The Brand's login POSTs a single-use assertion bound to the user_code.
  async function consent(
    request: Request,
    customer: typeof customers.$inferSelect,
    config: DelegationConfig,
    urls: Urls,
  ): Promise<Response> {
    const form = new URLSearchParams(await request.text());
    let claims: { sub: string; userCode: string; email: string; jti: string };
    try {
      const { payload } = await jwtVerify(
        form.get("assertion") ?? "",
        getJwks(`${config.brandUrl}/.well-known/jwks.json`),
        {
          algorithms: ["ES256", "RS256"],
          issuer: config.brandUrl,
          audience: urls.consent,
          currentDate: now(),
          maxTokenAge: "5m",
          requiredClaims: ["sub", "jti", "iat", "exp"],
        },
      );
      if (typeof payload.user_code !== "string" || typeof payload.email !== "string") {
        throw new Error("Assertion is missing user_code or email");
      }
      claims = {
        sub: payload.sub!,
        userCode: payload.user_code,
        email: payload.email,
        jti: payload.jti!,
      };
    } catch {
      return errorPage(customer.name, "The sign-in could not be verified. Try again.", 401);
    }
    const [fresh] = await options.db
      .insert(usedBrandAssertions)
      .values({ jti: claims.jti })
      .onConflictDoNothing()
      .returning();
    if (!fresh) return errorPage(customer.name, "This sign-in link was already used.");
    const pending = await pendingAuthorization(customer.id, claims.userCode);
    if (!pending)
      return errorPage(customer.name, "This request expired. Start again from your agent.");
    const requested = new Set(parseScope(pending.row.requestedScope));
    return consentPage({
      brandName: customer.name,
      color: config.color,
      providerName: "PACT reference provider",
      platformName: pending.platform.name,
      platformOrigin: new URL(pending.row.clientId).host,
      email: claims.email,
      scopes: config.scopes.map((scope) => ({ ...scope, requested: requested.has(scope.id) })),
      action: urls.consentDecision,
      session: await signConsentSession(claims, { audience: urls.consentDecision, now: now() }),
    });
  }

  async function decision(
    request: Request,
    customer: typeof customers.$inferSelect,
    config: DelegationConfig,
    urls: Urls,
  ): Promise<Response> {
    const form = new URLSearchParams(await request.text());
    let session: Awaited<ReturnType<typeof verifyConsentSession>>;
    try {
      session = await verifyConsentSession(form.get("session") ?? "", {
        audience: urls.consentDecision,
        now: now(),
      });
    } catch {
      return errorPage(customer.name, "This consent page expired. Start again from your agent.");
    }
    const pending = await pendingAuthorization(customer.id, session.userCode);
    if (!pending)
      return errorPage(customer.name, "This request expired. Start again from your agent.");
    const requested = parseScope(pending.row.requestedScope);
    const chosen = new Set(form.getAll("scope"));
    const granted = requested.filter((scope) => chosen.has(scope));
    const at = now();
    const done = new URL(`${config.brandUrl}/connected`);
    done.searchParams.set("client", pending.platform.name);

    if (form.get("decision") !== "allow" || granted.length === 0) {
      await options.db
        .update(deviceAuthorizations)
        .set({ status: "denied", brandUserId: session.sub })
        .where(
          and(
            eq(deviceAuthorizations.id, pending.row.id),
            eq(deviceAuthorizations.status, "pending"),
          ),
        );
      done.searchParams.set("status", "denied");
      return Response.redirect(done, 303);
    }

    const grantId = `a2agrant_${ulid()}`;
    await options.db.transaction(async (tx) => {
      const db = tx as unknown as Db;
      const [approved] = await db
        .update(deviceAuthorizations)
        .set({ status: "approved", brandUserId: session.sub, grantId })
        .where(
          and(
            eq(deviceAuthorizations.id, pending.row.id),
            eq(deviceAuthorizations.status, "pending"),
          ),
        )
        .returning();
      if (!approved) throw new Error("Device authorization is no longer pending");
      await db.insert(delegationGrants).values({
        id: grantId,
        customerId: customer.id,
        platformId: pending.row.platformId,
        clientId: pending.row.clientId,
        brandUserId: session.sub,
        scope: formatScope(granted),
        expiresAt: new Date(at.getTime() + GRANT_TTL_MS),
      });
    });
    done.searchParams.set("status", "approved");
    done.searchParams.set("scope", formatScope(granted));
    return Response.redirect(done, 303);
  }
}

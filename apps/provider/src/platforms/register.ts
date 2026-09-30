import { decodeJwt, decodeProtectedHeader, jwtVerify, type JWTVerifyGetKey } from "jose";
import { eq } from "drizzle-orm";
import { PlatformRegistrationRequestSchema, type RegisteredPlatform } from "@pac2/protocol";
import { getRemoteJwks } from "../auth/verifyPlatformJwt.js";
import { assertPlatformJwtTiming } from "../auth/platformJwtTiming.js";
import type { Db } from "../db/client.js";
import { agentPlatforms } from "../db/schema.js";
import { getProviderBaseUrl } from "../a2a/providerBaseUrl.js";

type RegisterPlatformOptions = {
  db: Db;
  getJwks?: (uri: string) => JWTVerifyGetKey;
  now?: () => Date;
};

type RegistrationResult =
  | { kind: "registered"; platform: RegisteredPlatform }
  | { kind: "conflict"; message: string };

function errorResponse(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

function unauthorized(reason: string): Response {
  console.warn("Platform registration authentication failed:", reason);
  return new Response(null, {
    status: 401,
    headers: { "WWW-Authenticate": 'Bearer realm="platforms"' },
  });
}

function platformResponse(platform: RegisteredPlatform, status: number): Response {
  return Response.json(
    {
      platform: {
        id: platform.id,
        name: platform.name,
        issuer: platform.issuer,
        jwksUri: platform.jwksUri,
        enabled: platform.enabled,
      },
    },
    { status },
  );
}

function parseAllowedUrl(value: string, name: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute URL`);
  }
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))
  ) {
    throw new Error(`${name} must use https, or http on localhost or 127.0.0.1`);
  }
  return url;
}

function validateRegistrationUrls(issuer: string, jwksUri: string): void {
  if (issuer.includes("?") || issuer.includes("#")) {
    throw new Error("Issuer must not include a query or fragment");
  }
  const normalizedIssuer = issuer.replace(/\/+$/, "");
  const issuerUrl = parseAllowedUrl(normalizedIssuer, "Issuer");
  const jwksUrl = parseAllowedUrl(jwksUri, "JWKS URI");
  if (issuerUrl.origin !== jwksUrl.origin) {
    throw new Error("JWKS URI must have the same origin as the issuer");
  }
}

export function createRegisterPlatformHandler(
  options: RegisterPlatformOptions,
): (request: Request) => Promise<Response> {
  const findRegistration = async (
    name: string,
    issuer: string,
    jwksUri: string,
  ): Promise<RegistrationResult | null> => {
    const [byIssuer, byName] = await Promise.all([
      options.db.query.agentPlatforms.findFirst({
        where: eq(agentPlatforms.issuer, issuer),
      }),
      options.db.query.agentPlatforms.findFirst({
        where: eq(agentPlatforms.name, name),
      }),
    ]);

    if (
      byIssuer &&
      byIssuer.name === name &&
      byIssuer.jwksUri === jwksUri &&
      byName?.id === byIssuer.id
    ) {
      return {
        kind: "registered",
        platform: {
          id: byIssuer.id,
          name: byIssuer.name,
          issuer: byIssuer.issuer,
          jwksUri: byIssuer.jwksUri,
          enabled: byIssuer.enabled,
        },
      };
    }
    if (byIssuer) {
      return { kind: "conflict", message: "Issuer is already registered with different details" };
    }
    if (byName) {
      return { kind: "conflict", message: "Platform name is already registered to another issuer" };
    }
    return null;
  };

  return async (request) => {
    let token: string;
    let issuer: string;
    let headerAlgorithm: string | undefined;
    try {
      const match = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i);
      if (!match?.[1]) return unauthorized("missing bearer token");
      token = match[1];
      headerAlgorithm = decodeProtectedHeader(token).alg;
      const claims = decodeJwt(token);
      if (typeof claims.iss !== "string") return unauthorized("missing issuer");
      issuer = claims.iss;
    } catch (error) {
      return unauthorized(error instanceof Error ? error.message : "invalid JWT");
    }

    const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (contentType !== "application/json") {
      return errorResponse("Content-Type must be application/json", 400);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse("Malformed JSON request body", 400);
    }
    const parsedBody = PlatformRegistrationRequestSchema.safeParse(body);
    if (!parsedBody.success) {
      return errorResponse(parsedBody.error.issues.map((issue) => issue.message).join("; "), 400);
    }

    try {
      validateRegistrationUrls(issuer, parsedBody.data.jwksUri);
    } catch (error) {
      return errorResponse(
        error instanceof Error ? error.message : "Invalid registration URLs",
        400,
      );
    }

    try {
      if (headerAlgorithm !== "ES256") throw new Error("unexpected algorithm");
      const getJwks = options.getJwks ?? getRemoteJwks;
      const audience = `${getProviderBaseUrl(request)}/api/platforms`;
      const { payload } = await jwtVerify(token, getJwks(parsedBody.data.jwksUri), {
        algorithms: ["ES256"],
        issuer,
        audience,
        clockTolerance: 30,
        requiredClaims: ["iss", "sub", "aud", "iat", "exp", "jti"],
      });
      if (
        typeof payload.sub !== "string" ||
        typeof payload.iat !== "number" ||
        typeof payload.exp !== "number" ||
        typeof payload.jti !== "string" ||
        payload.jti.length === 0
      ) {
        throw new Error("invalid required claims");
      }
      assertPlatformJwtTiming({
        iat: payload.iat,
        exp: payload.exp,
        now: options.now?.() ?? new Date(),
      });
      if (payload.sub !== issuer) throw new Error("subject must match issuer");
    } catch (error) {
      return unauthorized(error instanceof Error ? error.message : "JWT verification failed");
    }

    try {
      const existing = await findRegistration(
        parsedBody.data.name,
        issuer,
        parsedBody.data.jwksUri,
      );
      if (existing?.kind === "registered") return platformResponse(existing.platform, 200);
      if (existing?.kind === "conflict") return errorResponse(existing.message, 409);

      const [created] = await options.db
        .insert(agentPlatforms)
        .values({
          name: parsedBody.data.name,
          issuer,
          jwksUri: parsedBody.data.jwksUri,
          enabled: true,
        })
        .onConflictDoNothing()
        .returning();
      if (created) return platformResponse(created, 201);

      const raced = await findRegistration(parsedBody.data.name, issuer, parsedBody.data.jwksUri);
      if (raced?.kind === "registered") return platformResponse(raced.platform, 200);
      if (raced?.kind === "conflict") return errorResponse(raced.message, 409);
      return errorResponse("Internal error", 500);
    } catch (error) {
      console.error("Platform registration failed", error);
      return errorResponse("Internal error", 500);
    }
  };
}

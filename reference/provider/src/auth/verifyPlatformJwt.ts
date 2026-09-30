import {
  createRemoteJWKSet,
  decodeJwt,
  decodeProtectedHeader,
  jwtVerify,
  type JWTVerifyGetKey,
} from "jose";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { agentPlatforms } from "../db/schema.js";
import { assertPlatformJwtIssuedAt } from "./platformJwtTiming.js";

export interface PlatformAuth {
  platform: { id: string; name: string; audience: string | null };
  paUserId: string;
  claims: { sub: string; exp: number; iat: number };
}

const jwksCache = new Map<string, JWTVerifyGetKey>();
export function getRemoteJwks(jwksUri: string): JWTVerifyGetKey {
  let keySet = jwksCache.get(jwksUri);
  if (!keySet) {
    keySet = createRemoteJWKSet(new URL(jwksUri));
    jwksCache.set(jwksUri, keySet);
  }
  return keySet;
}

export async function verifyPlatformJwt(input: {
  authorization: string | null;
  defaultAudience: string;
  db: Db;
  getJwks?: (uri: string) => JWTVerifyGetKey;
  now?: () => Date;
}): Promise<PlatformAuth | null> {
  const now = input.now?.() ?? new Date();
  const reject = (reason: string): null => {
    console.warn("A2A platform authentication failed:", reason);
    return null;
  };
  try {
    const match = input.authorization?.match(/^Bearer\s+(.+)$/i);
    if (!match?.[1]) return reject("missing bearer token");
    const token = match[1];
    const header = decodeProtectedHeader(token);
    if (header.alg !== "RS256" && header.alg !== "ES256") return reject("unexpected algorithm");
    const unverifiedClaims = decodeJwt(token);
    if (typeof unverifiedClaims.iss !== "string") return reject("missing issuer");
    const platform = await input.db.query.agentPlatforms.findFirst({
      where: eq(agentPlatforms.issuer, unverifiedClaims.iss),
    });
    if (!platform || !platform.enabled) return reject("unknown or disabled platform");
    const getJwks = input.getJwks ?? getRemoteJwks;
    const audience = platform.audience ?? input.defaultAudience;
    const { payload } = await jwtVerify(token, getJwks(platform.jwksUri), {
      algorithms: ["RS256", "ES256"],
      issuer: platform.issuer,
      audience,
      clockTolerance: 30,
      requiredClaims: ["iss", "sub", "aud", "iat", "exp"],
    });
    if (
      typeof payload.sub !== "string" ||
      typeof payload.iat !== "number" ||
      typeof payload.exp !== "number" ||
      typeof payload.aud !== "string" ||
      payload.aud !== audience
    ) {
      return reject("invalid required claims");
    }
    assertPlatformJwtIssuedAt({ iat: payload.iat, now });
    return {
      platform: { id: platform.id, name: platform.name, audience: platform.audience },
      paUserId: `${platform.name}:${payload.sub}`,
      claims: { sub: payload.sub, exp: payload.exp, iat: payload.iat },
    };
  } catch (error) {
    console.warn(
      "A2A platform authentication failed:",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

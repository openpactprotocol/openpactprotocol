import {
  createRemoteJWKSet,
  decodeJwt,
  decodeProtectedHeader,
  jwtVerify,
  type JWTVerifyGetKey,
} from "jose";
import { and, eq, lte } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { agentPlatforms, customers, seenJtis } from "../db/schema.js";

export interface PlatformAuth {
  platform: { id: string; name: string };
  customer: typeof customers.$inferSelect;
  paUserId: string;
  claims: { sub: string; exp: number; iat: number; jti: string };
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
  slug: string;
  expectedAud: string;
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
    if (header.alg !== "ES256") return reject("unexpected algorithm");
    const unverifiedClaims = decodeJwt(token);
    if (typeof unverifiedClaims.iss !== "string") return reject("missing issuer");
    const platform = await input.db.query.agentPlatforms.findFirst({
      where: eq(agentPlatforms.issuer, unverifiedClaims.iss),
    });
    if (!platform || !platform.enabled) return reject("unknown or disabled platform");
    const getJwks = input.getJwks ?? getRemoteJwks;
    const { payload } = await jwtVerify(token, getJwks(platform.jwksUri), {
      algorithms: ["ES256"],
      issuer: platform.issuer,
      audience: input.expectedAud,
      clockTolerance: 30,
      requiredClaims: ["iss", "sub", "aud", "iat", "exp", "jti"],
    });
    if (
      typeof payload.sub !== "string" ||
      typeof payload.iat !== "number" ||
      typeof payload.exp !== "number" ||
      typeof payload.jti !== "string"
    ) {
      return reject("invalid required claims");
    }
    if (payload.exp - payload.iat > 300) return reject("token lifetime exceeds five minutes");
    if (payload.iat > Math.floor(now.getTime() / 1000) + 30) return reject("issued in the future");
    await input.db
      .delete(seenJtis)
      .where(and(eq(seenJtis.platformId, platform.id), lte(seenJtis.expiresAt, now)));
    const inserted = await input.db
      .insert(seenJtis)
      .values({
        platformId: platform.id,
        jti: payload.jti,
        expiresAt: new Date(payload.exp * 1000),
      })
      .onConflictDoNothing()
      .returning({ jti: seenJtis.jti });
    if (inserted.length === 0) return reject("replayed jti");
    const customer = await input.db.query.customers.findFirst({
      where: eq(customers.slug, input.slug),
    });
    if (!customer) return reject("unknown customer");
    return {
      platform: { id: platform.id, name: platform.name },
      customer,
      paUserId: `${platform.name}:${payload.sub}`,
      claims: { sub: payload.sub, exp: payload.exp, iat: payload.iat, jti: payload.jti },
    };
  } catch (error) {
    console.warn(
      "A2A platform authentication failed:",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

import { createHash, randomBytes } from "node:crypto";
import { CompactSign, createLocalJWKSet, jwtVerify, SignJWT } from "jose";
import {
  DelegationTokenClaimsSchema,
  ReceiptClaimsSchema,
  type DelegationTokenClaims,
  type Receipt,
  type ReceiptClaims,
} from "@openpactprotocol/protocol/delegation";
import { getSigningKey } from "./keys.js";

const ACCESS_TOKEN_TYPE = "at+jwt";
const CONSENT_SESSION_TYPE = "pact-consent+jwt";

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

export function randomToken(prefix: string): string {
  return `${prefix}${randomBytes(32).toString("base64url")}`;
}

function seconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

export async function signDelegationToken(
  claims: Omit<DelegationTokenClaims, "iat" | "exp">,
  options: { now: Date; ttlSeconds: number },
): Promise<string> {
  const key = await getSigningKey();
  const iat = seconds(options.now);
  return new SignJWT({
    ...(claims.authorization_details
      ? { authorization_details: claims.authorization_details }
      : {}),
    client_id: claims.client_id,
    scope: claims.scope,
    grant_id: claims.grant_id,
  })
    .setProtectedHeader({ alg: key.alg, kid: key.kid, typ: ACCESS_TOKEN_TYPE })
    .setIssuer(claims.iss)
    .setAudience(claims.aud)
    .setSubject(claims.sub)
    .setIssuedAt(iat)
    .setExpirationTime(iat + options.ttlSeconds)
    .sign(key.privateKey);
}

export async function verifyDelegationToken(
  token: string,
  options: { issuer: string; audience: string; now: Date },
): Promise<DelegationTokenClaims> {
  const key = await getSigningKey();
  const { payload } = await jwtVerify(token, createLocalJWKSet(key.jwks), {
    algorithms: ["ES256"],
    issuer: options.issuer,
    audience: options.audience,
    typ: ACCESS_TOKEN_TYPE,
    currentDate: options.now,
    requiredClaims: ["iss", "aud", "sub", "iat", "exp"],
  });
  return DelegationTokenClaimsSchema.parse(payload);
}

export type ConsentSession = { sub: string; userCode: string; email: string };

export async function signConsentSession(
  session: ConsentSession,
  options: { audience: string; now: Date },
): Promise<string> {
  const key = await getSigningKey();
  const iat = seconds(options.now);
  return new SignJWT({ user_code: session.userCode, email: session.email })
    .setProtectedHeader({ alg: key.alg, kid: key.kid, typ: CONSENT_SESSION_TYPE })
    .setAudience(options.audience)
    .setSubject(session.sub)
    .setIssuedAt(iat)
    .setExpirationTime(iat + 600)
    .sign(key.privateKey);
}

export async function verifyConsentSession(
  token: string,
  options: { audience: string; now: Date },
): Promise<ConsentSession> {
  const key = await getSigningKey();
  const { payload } = await jwtVerify(token, createLocalJWKSet(key.jwks), {
    algorithms: ["ES256"],
    audience: options.audience,
    typ: CONSENT_SESSION_TYPE,
    currentDate: options.now,
  });
  if (
    typeof payload.sub !== "string" ||
    typeof payload.user_code !== "string" ||
    typeof payload.email !== "string"
  ) {
    throw new Error("Invalid consent session");
  }
  return { sub: payload.sub, userCode: payload.user_code, email: payload.email };
}

export async function signReceipt(claims: ReceiptClaims): Promise<Receipt> {
  const key = await getSigningKey();
  const parsed = ReceiptClaimsSchema.parse(claims);
  const jws = await new CompactSign(new TextEncoder().encode(JSON.stringify(parsed)))
    .setProtectedHeader({ alg: key.alg, kid: key.kid, typ: "pact-receipt+jws" })
    .sign(key.privateKey);
  return { jws, claims: parsed };
}

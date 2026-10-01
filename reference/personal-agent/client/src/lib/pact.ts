import { randomUUID } from "node:crypto";
import { importJWK, SignJWT, type JWK } from "jose";
import { fetchAgentCard, interfaceUrl, type AgentCard } from "@pact/client";

export function agentCardUrl(providerUrl: string, customerId: string): string {
  return `${providerUrl.replace(/\/+$/, "")}/a2a/${encodeURIComponent(customerId)}/.well-known/agent-card.json`;
}

export async function discoverAgent(
  providerUrl: string,
  customerId: string,
): Promise<{ card: AgentCard; url: string }> {
  const card = await fetchAgentCard(agentCardUrl(providerUrl, customerId));
  return { card, url: interfaceUrl(card) };
}

export async function signPaJwt(input: {
  issuer: string;
  privateJwk: string;
  sub: string;
  aud: string;
}): Promise<string> {
  const jwk = JSON.parse(input.privateJwk) as JWK;
  if (typeof jwk.kid !== "string") throw new Error("PA_PRIVATE_JWK must include kid");
  const iat = Math.floor(Date.now() / 1000);
  return new SignJWT({ sub: input.sub })
    .setProtectedHeader({ alg: "ES256", kid: jwk.kid, typ: "JWT" })
    .setIssuer(input.issuer)
    .setAudience(input.aud)
    .setIssuedAt(iat)
    .setExpirationTime(iat + 120)
    .setJti(randomUUID())
    .sign(await importJWK(jwk, "ES256"));
}

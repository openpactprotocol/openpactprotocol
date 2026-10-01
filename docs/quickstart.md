---
title: Quickstart
description: Publish a key, onboard, find a Brand's agent, send a message.
---

You need a Provider that speaks PACT and a Brand ID on it. To try it locally
first, run the [reference implementation](reference-implementation.md); it ships
three demo Brands.

```sh
export PROVIDER_URL="https://provider.example.com"
export ISSUER="https://pa.example.com"           # your issuer URL
export JWKS_URI="$ISSUER/.well-known/jwks.json"
export BRAND_ID="01J…"                           # from the Provider
export PA_AUDIENCE="…"                           # from the Provider, at onboarding
export USER_SUB="user-7f3a"                      # opaque, stable per User
```

## 1. Create a key, publish a JWKS

```ts
import { exportJWK, generateKeyPair } from "jose";

const { publicKey, privateKey } = await generateKeyPair("ES256");
const kid = "pa-key-1";
const publicJwk = { ...(await exportJWK(publicKey)), kid, use: "sig", alg: "ES256" };
const privateJwk = { ...(await exportJWK(privateKey)), kid, use: "sig", alg: "ES256" };
```

Serve `{ "keys": [publicJwk] }` at `JWKS_URI`. Keep `privateJwk` where you
sign. Rotate by adding keys; the URI stays.

## 2. Onboard

Once per Provider, not per User or Brand. Give the Provider `ISSUER` and
`JWKS_URI`; it gives you `PA_AUDIENCE`. How is up to the Provider — usually a
partner form or a contact, not an API; some Providers accept any issuer that
serves a JWKS. (The reference Provider has a self-service endpoint; see
[Reference implementation](reference-implementation.md#self-service-registration).)

## 3. Find the Brand's agent

```sh
curl "$PROVIDER_URL/a2a/$BRAND_ID/.well-known/agent-card.json"
```

Take the `supportedInterfaces` entry with `protocolBinding: "HTTP+JSON"` and
`protocolVersion: "1.0"`. Its `url` is `INTERFACE_URL`.

## 4. Sign a JWT, send a message

```ts
import { SignJWT } from "jose";

const token = await new SignJWT({ sub: USER_SUB })
  .setProtectedHeader({ alg: "ES256", kid })
  .setIssuer(ISSUER)
  .setAudience(PA_AUDIENCE)
  .setIssuedAt()
  .setExpirationTime("2m")
  .sign(privateKey);
```

```sh
curl -X POST "$INTERFACE_URL/message:send" \
  -H "Authorization: Bearer $TOKEN" \
  -H "A2A-Version: 1.0" \
  -H "Content-Type: application/json" \
  -d '{"message":{"messageId":"m-001","role":"ROLE_USER","parts":[{"text":"Where is my order?"}]}}'
```

```json
{
  "message": {
    "messageId": "r-001",
    "contextId": "f0c12e6b-…",
    "role": "ROLE_AGENT",
    "parts": [{ "text": "…" }]
  }
}
```

## 5. Continue

Send the next message with the `contextId`:

```json
{
  "message": {
    "messageId": "m-002",
    "contextId": "f0c12e6b-…",
    "role": "ROLE_USER",
    "parts": [{ "text": "Order 4471" }]
  }
}
```

Same `contextId` + same `messageId` is a safe retry; you get the stored reply.
See [Specification §4](spec.md#4-messages).

Your JWT says which PA is calling, not who the User is. When the agent needs
to know, it asks in conversation (order number, email, …) and you relay the
User's answers, as in a chat widget. No account credentials go through you.

## 6. If the card offers delegated authority

Some cards also carry an `oauth2SecurityScheme` with a `deviceCode` flow and
the scopes that Brand defined for its own use cases. For actions on the User's account, run the device-code
flow — the User logs in with the Brand and approves scopes — and send the
token with your JWT:

```http
Authorization: Bearer $TOKEN
X-A2A-User-Delegation: Bearer $DELEGATION_TOKEN
```

Everything else is the same. See
[Specification §5](spec.md#5-delegated-authority).

## Same thing in TypeScript

```ts
import { A2AClient, createPlatformSigner, discoverAgent } from "@pac2/client";

const signer = createPlatformSigner({ issuer: ISSUER, privateJwk });
const { url } = await discoverAgent(PROVIDER_URL, BRAND_ID);
const client = new A2AClient({ url, signer, userId: USER_SUB, audience: PA_AUDIENCE });

const first = await client.sendMessage("Where is my order?");
const next = await client.sendMessage("Order 4471", { contextId: first.contextId });
```

Or from a shell: `pac2 card`, `pac2 send "Where is my order?"`, `pac2 chat` —
see [TypeScript client](typescript-client.md).

---
title: Quickstart
description: Register an ES256 platform, discover a Customer agent, and send a message with curl or the TypeScript client.
---

This walkthrough uses the self-serve registration endpoint in the reference
provider. A production provider may use a different onboarding process; the
runtime Agent Card and message flow are described in the
[integration guide](/guides/registration).

Set these values for your environment:

```sh
export PROVIDER_URL="https://provider.example.com"
export ISSUER="https://agent.example.com"
export JWKS_URI="$ISSUER/.well-known/jwks.json"
export CUSTOMER_ID="01J..."
export USER_SUB="user-7f3a"
```

## 1. Create and publish an ES256 key

Generate a key pair with `jose`, assign a stable key ID, and publish the public
JWK at `JWKS_URI` as a JWKS document. Keep the private JWK on the trusted
platform server only.

```ts
import { exportJWK, generateKeyPair } from "jose";

const { publicKey, privateKey } = await generateKeyPair("ES256");
const kid = "platform-key-1";
const publicJwk = { ...(await exportJWK(publicKey)), kid, use: "sig", alg: "ES256" };
const privateJwk = { ...(await exportJWK(privateKey)), kid, use: "sig", alg: "ES256" };
const jwks = { keys: [publicJwk] };
```

Publish `jwks` at the issuer's origin, then keep `privateJwk` available to the
service that signs registration and runtime assertions. The JWKS can be
rotated later without changing the registered issuer.

## 2. Register the platform

The reference provider's registration assertion is signed by the platform's
own ES256 key. It uses the registration endpoint as its audience, sets
`sub` equal to `iss`, includes a `jti`, and expires within five minutes.

Create a short-lived assertion with `jose`:

```ts
import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";

const registrationAudience = `${PROVIDER_URL}/api/platforms`;
const registrationToken = await new SignJWT({ sub: ISSUER })
  .setProtectedHeader({ alg: "ES256", kid })
  .setIssuer(ISSUER)
  .setAudience(registrationAudience)
  .setIssuedAt()
  .setExpirationTime("2m")
  .setJti(randomUUID())
  .sign(privateKey);
```

Send the assertion and the public JWKS location:

```sh
export REGISTRATION_TOKEN="<registrationToken from the jose snippet>"

curl -X POST "$PROVIDER_URL/api/platforms" \
  -H "Authorization: Bearer $REGISTRATION_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"instinct\",\"jwksUri\":\"$JWKS_URI\"}"
```

A first registration returns `201`; an identical retry returns `200`. See
[registration](/guides/registration) for URL validation and conflicts.

## 3. Discover the Customer agent

Agent Cards are public. Fetch the card for the Customer ID supplied to your
platform:

```sh
curl "$PROVIDER_URL/a2a/$CUSTOMER_ID/.well-known/agent-card.json"
```

Select the `supportedInterfaces` entry with `protocolBinding` `HTTP+JSON` and
`protocolVersion` `1.0`. Its URL is the customer-specific interface base.

## 4. Sign and send a message

Runtime tokens identify the registered platform in `iss`; `sub` is a stable,
pseudonymous user handle; and `aud` defaults to `$PROVIDER_URL/a2a`. Unlike a
registration assertion, a runtime token does not require a `jti`.

```ts
const runtimeToken = await new SignJWT({ sub: USER_SUB })
  .setProtectedHeader({ alg: "ES256", kid })
  .setIssuer(ISSUER)
  .setAudience(`${PROVIDER_URL}/a2a`)
  .setIssuedAt()
  .setExpirationTime("2m")
  .sign(privateKey);
```

Use the interface URL from the Agent Card:

```sh
export RUNTIME_TOKEN="<runtimeToken from the jose snippet>"

curl -X POST "$INTERFACE_URL/message:send" \
  -H "Authorization: Bearer $RUNTIME_TOKEN" \
  -H "A2A-Version: 1.0" \
  -H "Content-Type: application/json" \
  -d '{"message":{"messageId":"message-1","role":"ROLE_USER","parts":[{"text":"I need help"}]}}'
```

The response is `{ "message": ... }`. Save its `contextId` and include it in
the next user message to continue the same conversation. Read
[messaging](/guides/messaging) for message validation, ownership, and retry
semantics.

## Use the reference TypeScript client

The repository's `@pac2/client` package wraps platform signing, card discovery,
registration, and message requests:

```ts
import { A2AClient, createPlatformSigner, discoverAgent, registerPlatform } from "@pac2/client";

const signer = createPlatformSigner({ issuer: ISSUER, privateJwk });
await registerPlatform({ providerUrl: PROVIDER_URL, name: "instinct", signer });

const discovered = await discoverAgent(PROVIDER_URL, CUSTOMER_ID);
const client = new A2AClient({
  url: discovered.url,
  signer,
  userId: USER_SUB,
});
const firstReply = await client.sendMessage("I need help");
const nextReply = await client.sendMessage("Can you clarify?", {
  contextId: firstReply.contextId,
});
```

The reference client is maintained in this repository; see the
[TypeScript client reference](/reference/typescript-client) for its API and
CLI.

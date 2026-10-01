---
title: Quickstart
description: Send your first message to a Brand's agent and continue the conversation.
---

You'll send a message to a Brand's support agent, then continue the
conversation. You need four values:

```sh
export PROVIDER_URL="https://provider.example.com"
export BRAND_ID="01J…"                   # the Brand you want to reach
export PA_ISSUER="https://pa.example.com" # your personal agent's URL
export PA_AUDIENCE="…"                   # the Provider gives you this when you register
```

## Try it locally first

The [reference implementation](reference-implementation.md#run-it-locally)
runs a Provider with three demo Brands and has already registered a demo personal agent.
Once it's running, use these values:

```sh
export PROVIDER_URL="http://localhost:3000"
export BRAND_ID="01M3R53Q5WKZ7A0GY4PZ8Y39TB"   # Loom & Co.
export PA_ISSUER="http://localhost:3002"
export PA_AUDIENCE="http://localhost:3000/a2a"
```

`pnpm gen-keys` has already created a signing key (`PA_PRIVATE_JWK` in
`reference/personal-agent/client/.env.local`), so you can skip to
[step 3](#3-send-a-message). Or send a message straight from the CLI:

```sh
CUSTOMER_ID="$BRAND_ID" pnpm --filter @pact/client pact send "Where is my order?"
```

## 1. Create a signing key

```ts
import { exportJWK, generateKeyPair } from "jose";

const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
const kid = "pa-key-1";
const publicJwk = { ...(await exportJWK(publicKey)), kid, use: "sig", alg: "ES256" };
const privateJwk = { ...(await exportJWK(privateKey)), kid, use: "sig", alg: "ES256" };
```

Publish `{ "keys": [publicJwk] }` at a public URL, for example
`$PA_ISSUER/.well-known/jwks.json`. Keep `privateJwk` on your server. To rotate
keys, add new ones at the same URL.

## 2. Register with the Provider

Do this once per Provider, not per User or Brand. Give the Provider your
issuer URL and JWKS URL; it gives you `PA_AUDIENCE`. Each Provider decides how
— usually a partner form. The reference Provider has a
[self-service endpoint](reference-implementation.md#self-service-registration).

## 3. Send a message

```ts
import { A2AClient, createPlatformSigner, discoverAgent } from "@pact/client";

const signer = createPlatformSigner({ issuer: PA_ISSUER, privateJwk });
const { url } = await discoverAgent(PROVIDER_URL, BRAND_ID);
const client = new A2AClient({ url, signer, userId: "user-7f3a", audience: PA_AUDIENCE });

const reply = await client.sendMessage("Where is my order?");
```

`userId` is your id for the User. It must be stable and opaque: the same User
always gets the same id, and it contains no personal data.

`@pact/client` isn't published to npm yet. Use it inside this repository, or
copy `packages/client/src/index.ts` (one file, depends only on `jose` and
`@pact/protocol`).

## 4. Continue the conversation

The reply includes a `contextId`. Send it with the next message:

```ts
const next = await client.sendMessage("Order 4471", { contextId: reply.contextId });
```

The agent may ask the User to prove who they are (an order number, an email).
Pass the question to the User and their answer back, as in a chat widget.

That's it. To act on the User's account (cancel an order, change a booking),
a Brand can also offer delegated authority — see
[Specification §5](spec.md#5-delegated-authority). It isn't implemented in the
reference Provider yet.

## What's on the wire

The client makes two HTTP calls. To make them yourself:

**Find the agent.** No token needed.

```sh
curl "$PROVIDER_URL/a2a/$BRAND_ID/.well-known/agent-card.json"
```

In `supportedInterfaces`, take the entry with `protocolBinding: "HTTP+JSON"`
and `protocolVersion: "1.0"`. Its `url` is the interface URL.

**Sign a token.** A JWT with `iss` = your issuer, `aud` = `PA_AUDIENCE`,
`sub` = the User's id, and a short expiry. With the client's signer:

```ts
console.log(await signer.sign({ sub: "user-7f3a", aud: PA_AUDIENCE }));
```

**Send the message.**

```sh
export INTERFACE_URL="…"   # from the Agent Card
export TOKEN="…"           # from signer.sign()

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

To continue, add `"contextId": "f0c12e6b-…"` to the next message. Resending
the same `messageId` with the same `contextId` is a safe retry: you get the
stored reply. Full rules are in [Specification §4](spec.md#4-messages).

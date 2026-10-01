---
title: Quickstart
description: Send your first message to a Brand's agent and continue the conversation.
---

You'll send a message to a Brand's support agent, then continue the
conversation. You need three values:

```sh
export AGENT_CARD_URL="…"                 # the Brand gives you this
export PA_ISSUER="https://pa.example.com" # your personal agent's URL
export PA_AUDIENCE="…"                   # the Provider gives you this when you register
```

## Try it locally first

The [reference implementation](reference-implementation.md#run-it-locally)
runs a Provider with three demo Brands and has already registered a demo personal agent.
Once it's running, use these values:

```sh
export AGENT_CARD_URL="http://localhost:3000/a2a/01M3R53Q5WKZ7A0GY4PZ8Y39TB/.well-known/agent-card.json" # Loom & Co.
export PA_ISSUER="http://localhost:3002"
export PA_AUDIENCE="http://localhost:3000/a2a"
```

`pnpm gen-keys` has already created a signing key (`PA_PRIVATE_JWK` in
`reference/personal-agent/client/.env.local`), so you can skip to
[step 3](#3-sign-a-token). Or send a message straight from the CLI:

```sh
pnpm --filter @pact/client pact send "Where is my order?"
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

## 3. Sign a token

Every request carries a JWT signed with your key: `iss` = your issuer,
`aud` = `PA_AUDIENCE`, `sub` = your id for the User, short expiry.
`createPlatformSigner` sets the header and claims PACT expects
([spec §3.2](spec.md#32-pa-jwt)); any JWT library works too.

```ts
import { createPlatformSigner } from "@pact/client";

const signer = createPlatformSigner({ issuer: PA_ISSUER, privateJwk });
const token = await signer.sign({ sub: "user-7f3a", aud: PA_AUDIENCE });
```

`sub` must be stable and opaque: the same User always gets the same id, and
it contains no personal data.

## 4. Send a message

The Brand tells you where its Agent Card is. The card says where to send
messages.

```ts
import { A2AClient, fetchAgentCard, interfaceUrl } from "@pact/client";

const card = await fetchAgentCard(AGENT_CARD_URL);
const client = new A2AClient({
  url: interfaceUrl(card),
  getToken: () => signer.sign({ sub: "user-7f3a", aud: PA_AUDIENCE }),
});

const reply = await client.sendMessage("Where is my order?");
```

`@pact/client` isn't published to npm yet. Use it inside this repository, or
copy `packages/client/src/index.ts` (one file, depends only on `jose` and
`@pact/protocol`).

## 5. Continue the conversation

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

**Fetch the Agent Card.** No token needed.

```sh
curl "$AGENT_CARD_URL"
```

In `supportedInterfaces`, take the entry with `protocolBinding: "HTTP+JSON"`
and `protocolVersion: "1.0"`. Its `url` is the interface URL.

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

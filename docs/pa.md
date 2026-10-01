---
title: Build a PA integration
description: Make a personal-agent platform speak PACT - publish keys, onboard with a Provider, sign a JWT, send messages.
---

For engineers adding PACT to a personal-agent platform (a **PA**). Six steps,
each with a check. The normative rules are in the [specification](spec.md);
this page is the happy path.

Two values come from outside: an **Agent Card URL** for each Brand (the Brand
gives it to you) and an **audience** string for each Provider (step 2).

`@pact/client` (`packages/client/src/index.ts`) does steps 3–6 in TypeScript.
It isn't on npm yet: import it inside this repository or copy the file (it
depends on `jose` and `@pact/protocol`). Any language works; the HTTP is
shown at every step.

## 1. Publish a signing key

Generate an ES256 (or RS256) key with a `kid`. Serve the public half as a JWKS
at a stable HTTPS URL; keep the private half on your server.

```ts
import { exportJWK, generateKeyPair } from "jose";

const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
const kid = "pa-key-1";
const publicJwk = { ...(await exportJWK(publicKey)), kid, use: "sig", alg: "ES256" };
const privateJwk = { ...(await exportJWK(privateKey)), kid, use: "sig", alg: "ES256" };
// serve { keys: [publicJwk] } at `${PA_ISSUER}/.well-known/jwks.json`
```

`PA_ISSUER` is your platform's URL. It becomes the `iss` claim. Rotate keys by
adding new ones to the same JWKS; the URL never changes.

**Done when** `curl $PA_ISSUER/.well-known/jwks.json` returns `{ "keys": [ … ] }`
containing your public key.

## 2. Onboard with each Provider

Once per Provider — not per User, not per Brand. Give the Provider your
issuer URL and JWKS URL; it gives you an audience string (`PA_AUDIENCE`).
Each Provider decides how (usually a partner form). The reference Provider
has a [self-service endpoint](running.md#self-service-registration).

**Done when** you have `PA_AUDIENCE` for that Provider.

## 3. Sign a PA JWT

Every request to the Provider carries `Authorization: Bearer <pa-jwt>`, a
short-lived JWT you sign per request
([spec §3.2](spec.md#32-pa-jwt)).

| Header / claim | Value                                                   |
| -------------- | ------------------------------------------------------- |
| `alg`, `kid`   | `ES256` or `RS256`; the `kid` of a key in your JWKS     |
| `iss`          | `PA_ISSUER`                                             |
| `sub`          | Your id for this User: stable, opaque, no personal data |
| `aud`          | `PA_AUDIENCE` for this Provider                         |
| `iat`, `exp`   | Now, and ≤ 300 s later (120 s is typical)               |
| `jti`          | Optional unique id                                      |

```ts
import { createPlatformSigner } from "@pact/client";

const signer = createPlatformSigner({ issuer: PA_ISSUER, privateJwk });
const token = await signer.sign({ sub: "user-7f3a", aud: PA_AUDIENCE });
```

**Done when** `jwtVerify(token, yourJwks, { issuer: PA_ISSUER, audience: PA_AUDIENCE })`
succeeds and the payload has `sub`, `iat`, `exp`.

## 4. Fetch the Brand's Agent Card

No token needed. In `supportedInterfaces`, take the entry with
`protocolBinding: "HTTP+JSON"` and `protocolVersion: "1.0"`; its `url` is the
**interface URL**. Pick by binding and version, not by position.

```sh
curl "$AGENT_CARD_URL"
```

```ts
import { fetchAgentCard, interfaceUrl } from "@pact/client";

const card = await fetchAgentCard(AGENT_CARD_URL); // validated against the schema
const url = interfaceUrl(card); // throws if there is no HTTP+JSON 1.0 interface
```

**Done when** you have the interface URL. `404` means the Brand is unknown to
that Provider.

## 5. Send a message and keep the conversation

`POST {interfaceUrl}/message:send`. The reply is synchronous and carries a
`contextId`; send it back with every later message for the same User and
Brand ([spec §4](spec.md#4-messages)).

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
    "parts": [{ "text": "Sure — what's the order number?" }]
  }
}
```

```ts
import { A2AClient } from "@pact/client";

const client = new A2AClient({
  url,
  getToken: () => signer.sign({ sub: "user-7f3a", aud: PA_AUDIENCE }), // called per request
});
const first = await client.sendMessage("Where is my order?");
const next = await client.sendMessage("Order 4471", { contextId: first.contextId });
```

- Use a fresh `messageId` per message. Resending the same `messageId` with
  the same `contextId` is a safe retry: you get the stored reply.
- The agent may ask the User to prove who they are (order number, email).
  Relay the question and the answer, as a chat widget would.
- One `contextId` per User per Brand; store it with the User.

**Done when** the reply has `role: "ROLE_AGENT"` and a `contextId`, and a
second message with that `contextId` continues the conversation.

## 6. Handle errors

| Response                                 | Meaning                                        | Do                                    |
| ---------------------------------------- | ---------------------------------------------- | ------------------------------------- |
| `401` + `WWW-Authenticate: Bearer`       | Token rejected (claims, signature, unknown PA) | Fix the token; don't retry as is      |
| `429` + `Retry-After`                    | Rate limited                                   | Wait that long, then retry            |
| `404`                                    | Unknown Brand or route                         | Check the card URL                    |
| Envelope, reason `INVALID_PARAMS`        | Bad request, or a `contextId` that isn't yours | Fix the request / start a new context |
| Envelope, reason `UNSUPPORTED_OPERATION` | Conversation closed, or an unsupported route   | Omit `contextId` to start a new one   |

A2A errors come as an envelope; the reason is `error.details[0].reason`, not
the HTTP status ([spec §6](spec.md#6-errors)). `A2AClient` throws `A2AError`
(`reason`, `status`, `details`) for envelopes and `A2AHttpError` (`status`,
`body`) for everything else.

## Test against the reference Provider

Run the stack in [Run the reference stack](running.md#run-it-locally). It seeds
three Brands and already trusts the demo PA key that `pnpm gen-keys` wrote to
`reference/personal-agent/client/.env.local` (`PA_PRIVATE_JWK`).

```sh
export AGENT_CARD_URL="http://localhost:3000/a2a/01M3R53Q5WKZ7A0GY4PZ8Y39TB/.well-known/agent-card.json" # Loom & Co.
export PA_ISSUER="http://localhost:3002"
export PA_AUDIENCE="http://localhost:3000/a2a"
```

**Done when** steps 4–5 return a reply from Loom & Co. with a `contextId`.

## Later: act on the User's account

A Brand can offer delegated authority — the User logs in with the Brand and
approves scopes, and the agent acts on their account. It's optional,
advertised on the Agent Card, and specified in
[spec §5](spec.md#5-delegated-authority); the reference Provider doesn't
implement it yet. Nothing above changes when you add it.

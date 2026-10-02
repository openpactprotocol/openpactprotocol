---
title: Build a personal agent integration
description: Make a personal-agent platform speak PACT.
---

For engineers adding PACT to a personal agent. The rules
are in the [specification](spec.md); this is the happy path. `@openpactprotocol/client`
(`packages/client/src/index.ts`, one file — import it from this repository or
copy it) does steps 3–5 in TypeScript; any language works.

Two values come from outside: each Brand's **Agent Card URL** (standard:
the Brand's own `/.well-known/agent-card.json`; or a link or public registry
entry pointing to it) and each Provider's **audience** string (step 2).

Variables prefixed `PA_` (personal agent) configure your platform.

## 1. Publish a signing key

Generate an ES256 key with a `kid`. Serve the public JWK as a JWKS at
`{PA_ISSUER}/.well-known/jwks.json`. `PA_ISSUER` is your platform's URL and
becomes the `iss` claim.

**Done when** `curl $PA_ISSUER/.well-known/jwks.json` returns `{ "keys": [ … ] }`.

## 2. Onboard with each Provider

Once per Provider, not per User or Brand. Send your issuer and JWKS URL;
receive `PA_AUDIENCE`. The reference Provider has a
[self-service endpoint](running.md#register-a-personal-agent).

**Done when** you have `PA_AUDIENCE`.

## 3. Sign a personal-agent JWT

One per request, valid ≤ 300 s ([spec §3.2](spec.md#32-personal-agent-jwt)): header
`kid`; `iss` = `PA_ISSUER`; `sub` = your stable, opaque id for the User;
`aud` = `PA_AUDIENCE`; `iat`, `exp`.

```ts
import { createPlatformSigner } from "@openpactprotocol/client";

const signer = createPlatformSigner({ issuer: PA_ISSUER, privateJwk });
const token = await signer.sign({ sub: "user-7f3a", aud: PA_AUDIENCE });
```

**Done when** `jwtVerify(token, yourJwks, { issuer: PA_ISSUER, audience: PA_AUDIENCE })`
succeeds.

## 4. Fetch the Brand's Agent Card

No token. The **interface URL** is the `url` of the `supportedInterfaces`
entry with `protocolBinding: "HTTP+JSON"` and `protocolVersion: "1.0"`.

```ts
import { fetchAgentCard, interfaceUrl } from "@openpactprotocol/client";

const url = interfaceUrl(await fetchAgentCard(AGENT_CARD_URL));
```

**Done when** you have the interface URL. `404` means the Brand is unknown
to that Provider.

## 5. Send messages

`POST {interfaceUrl}/message:send` with `Authorization: Bearer <token>` and
`A2A-Version: 1.0` ([spec §4](spec.md#4-messages)). The reply carries a
`contextId`; send it with every later message for the same User and Brand.
Use a fresh `messageId` per message — resending one is a safe retry.

```sh
curl -X POST "$INTERFACE_URL/message:send" \
  -H "Authorization: Bearer $TOKEN" -H "A2A-Version: 1.0" -H "Content-Type: application/json" \
  -d '{"message":{"messageId":"m-001","role":"ROLE_USER","parts":[{"text":"Where is my order?"}]}}'
```

```ts
import { A2AClient } from "@openpactprotocol/client";

const client = new A2AClient({
  url,
  getToken: () => signer.sign({ sub: "user-7f3a", aud: PA_AUDIENCE }),
});
const first = await client.sendMessage("Where is my order?");
const next = await client.sendMessage("Order 4471", { contextId: first.contextId });
```

The agent may ask the User to prove who they are (order number, email); relay
the question and answer as a chat widget would.

**Done when** the reply has `role: "ROLE_AGENT"` and a `contextId`, and a
second message with that `contextId` continues the conversation.

## 6. Handle errors

| Response                                 | Meaning                                                    | Do                                    |
| ---------------------------------------- | ---------------------------------------------------------- | ------------------------------------- |
| `401` + `WWW-Authenticate: Bearer`       | Token rejected (claims, signature, unknown personal agent) | Fix the token; don't retry as is      |
| `429` + `Retry-After`                    | Rate limited                                               | Wait that long, then retry            |
| `404`                                    | Unknown Brand or route                                     | Check the card URL                    |
| Envelope, reason `INVALID_PARAMS`        | Bad request, or a `contextId` that isn't yours             | Fix the request / start a new context |
| Envelope, reason `UNSUPPORTED_OPERATION` | Conversation closed, or an unsupported route               | Omit `contextId` to start a new one   |

The reason is `error.details[0].reason` ([spec §6](spec.md#6-errors)).
`A2AClient` throws `A2AError` for envelopes and `A2AHttpError` for the rest.

## Test locally

Start the [reference stack](running.md#run-it-locally); it already trusts the
demo key from `pnpm gen-keys`.

```sh
export AGENT_CARD_URL="http://localhost:3000/a2a/01M3R53Q5WKZ7A0GY4PZ8Y39TB/.well-known/agent-card.json"
export PA_ISSUER="http://localhost:3002"
export PA_AUDIENCE="http://localhost:3000/a2a"
```

**Done when** steps 4–5 return a reply from Loom & Co. with a `contextId`.

Delegated authority — the User logs in with the Brand and approves scopes so
the agent can act on their account — is optional, advertised on the card, and
in [spec §5](spec.md#5-delegated-authority). Nothing above changes.

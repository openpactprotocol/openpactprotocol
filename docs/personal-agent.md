---
title: Build a personal agent integration
description: Make a personal-agent platform speak PACT.
---

For engineers adding PACT to a personal agent. This is the happy path; the
rules are in the [specification](spec.md). Any language works. In TypeScript,
the reference client `@openpactprotocol/client` (`packages/client/src/index.ts`
in this repository) does steps 3–5.

> Covers the **PACT Identity** profile only. Delegated authority is in
> [spec §5](spec.md#5-delegated-authority).

## Values you need

| Value          | Who provides it                                                                                      | Used for                                                     |
| -------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `PA_ISSUER`    | You: your platform's URL (`PA_` stands for personal agent)                                           | The JWT's `iss`; your JWKS lives under it (step 1)           |
| Signing key    | You: an ES256 key pair with a `kid` (step 1)                                                         | The public key goes in your JWKS; the private key signs JWTs |
| User ID        | You: a stable, opaque id for each User                                                               | The JWT's `sub` (step 3)                                     |
| Audience       | Each Provider, when you register (step 2)                                                            | The JWT's `aud` (step 3)                                     |
| Agent Card URL | Each Brand: usually `https://{brandDomain}/.well-known/agent-card.json`, or a link or registry entry | Finding the Brand's interface URL (step 4)                   |

## 1. Publish a signing key

Generate an ES256 key with a `kid`. Serve the public JWK as a JWKS at
`{PA_ISSUER}/.well-known/jwks.json`. `PA_ISSUER` is your platform's URL and
becomes the `iss` claim. In this repository, `pnpm gen-keys` generates a key
pair in this format.

An example JWKS with one public key:

```json
{
  "keys": [
    {
      "kty": "EC",
      "crv": "P-256",
      "x": "32yODbRN1le9sJisAM16fORoi3d_i19xMlEFQsSz6uw",
      "y": "WufjW10h9FnHjf6vvEgMRlhRllzt4EYYFNB0HRSU_F8",
      "kid": "EkP2hB9FBw2yq4fSePcMSsPN8g5LtvKa7JDorgV0yvA",
      "alg": "ES256",
      "use": "sig"
    }
  ]
}
```

Publish only the public key. The private key has an extra `d` field; keep it
secret and use it to sign tokens (step 3).

**Done when** `curl $PA_ISSUER/.well-known/jwks.json` returns `{ "keys": [ … ] }`.

## 2. Register with each Provider

Once per Provider, not per User or Brand. Send your issuer and JWKS URL; the
Provider replies with its audience, a string you copy into `aud` (step 3). The
reference Provider has a
[self-service endpoint](running.md#register-a-personal-agent).

**Done when** you have the Provider's audience.

## 3. Sign a personal-agent JWT

One per request, valid ≤ 300 s ([spec §3.2](spec.md#32-personal-agent-jwt)): header
`kid`; `iss` = `PA_ISSUER`; `sub` = your stable, opaque id for the User;
`aud` = the Provider's audience; `iat`, `exp`.

```ts
import { createPlatformSigner } from "@openpactprotocol/client";

const signer = createPlatformSigner({ issuer: PA_ISSUER, privateJwk });
const token = await signer.sign({ sub: "user-7f3a", aud: audience });
```

**Done when** `jwtVerify(token, yourJwks, { issuer: PA_ISSUER, audience })` succeeds.

## 4. Fetch the Brand's Agent Card

No token. The **interface URL** is the `url` of the `supportedInterfaces`
entry with `protocolBinding: "HTTP+JSON"` and `protocolVersion: "1.0"`. A
trimmed card (full example in [spec §2.1](spec.md#21-agent-card)):

```json
{
  "name": "Example Co. Support",
  "supportedInterfaces": [
    {
      "url": "https://provider.example.com/a2a/01J…",
      "protocolBinding": "HTTP+JSON",
      "protocolVersion": "1.0"
    }
  ],
  "securitySchemes": {
    "paJwt": { "httpAuthSecurityScheme": { "scheme": "Bearer", "bearerFormat": "JWT" } }
  }
}
```

`interfaceUrl` returns `https://provider.example.com/a2a/01J…` here. Step 5
sends to `{interfaceUrl}/message:send`.

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
  getToken: () => signer.sign({ sub: "user-7f3a", aud: audience }),
});
const first = await client.sendMessage("Where is my order?");
const next = await client.sendMessage("Order 4471", { contextId: first.contextId });
```

The agent may ask the User to prove who they are (order number, email); relay
the question and answer.

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
export AUDIENCE="http://localhost:3000/a2a"
```

**Done when** steps 4–5 return a reply from Loom & Co. with a `contextId`.

Delegated authority is optional: the User logs in with the Brand and approves
scopes, so the Brand's agent can act on their account. Brands advertise it on
their card; [spec §5](spec.md#5-delegated-authority) defines it. Nothing above
changes.

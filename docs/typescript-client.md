---
title: TypeScript client
description: Use @pac2/client — signer, Agent Card discovery, A2AClient, errors, and the pac2 CLI.
---

`@pac2/client` (`packages/client`) is the PA side of the
[specification](spec.md). Small enough to read; copy it or import it.

## Sign

```ts
import { createPlatformSigner } from "@pac2/client";

const signer = createPlatformSigner({ issuer: "https://pa.example.com", privateJwk });
```

`sign({ sub, aud, ttlSeconds? })` produces an ES256 JWT with `iss`, `sub`,
`aud`, `iat`, `exp`, and a `jti`. `ttlSeconds` defaults to 120 and is capped
at 300. The private JWK must carry a `kid`.

## Discover and send

```ts
import { A2AClient, discoverAgent } from "@pac2/client";

const { card, url } = await discoverAgent(providerUrl, brandId);
const client = new A2AClient({ url, signer, userId: "user-7f3a", audience });

const first = await client.sendMessage("I need help");
const next = await client.sendMessage("Here is more detail", { contextId: first.contextId });
```

- `discoverAgent` validates the card and selects the `HTTP+JSON` / `1.0`
  interface.
- `audience` is required: the value the Provider gave you at onboarding. No
  default.
- `sendMessage(text, { contextId? })` sends a `ROLE_USER` text message with a
  fresh `messageId`, sets `A2A-Version: 1.0`, and returns the agent `Message`.

## Errors

| Class                       | Thrown when                                                       | Fields                                      |
| --------------------------- | ----------------------------------------------------------------- | ------------------------------------------- |
| `A2AError`                  | The Provider returned an A2A error envelope                       | `httpStatus`, `status`, `reason`, `details` |
| `A2AHttpError`              | Non-2xx without an envelope, e.g. `401` or `404`                  | `status`, `body`                            |
| `PlatformRegistrationError` | The reference Provider's registration endpoint rejected a request | `status`                                    |

## Register with the reference Provider

```ts
import { registerPlatform } from "@pac2/client";

const { created, platform } = await registerPlatform({ providerUrl, name: "my-platform", signer });
```

Calls the reference Provider's self-service endpoint
([Reference implementation](reference-implementation.md#self-service-registration)).
`jwksUri` defaults to `{issuer}/.well-known/jwks.json`; `created` is `true`
on `201`, `false` on an idempotent `200`. Not needed for Providers that onboard
out of band.

## CLI

```sh
pac2 card                              # print the Brand's Agent Card
pac2 send <text> [--context <id>]      # one message:send, prints the reply Message
pac2 chat                              # interactive loop that carries contextId
pac2 register [--name <n>] [--jwks-uri <url>]   # reference Provider only
```

| Variable                      | Used by                                         |
| ----------------------------- | ----------------------------------------------- |
| `PROVIDER_URL`                | all commands                                    |
| `CUSTOMER_ID`                 | the Brand ID; `card`, `send`, `chat`            |
| `PA_ISSUER`, `PA_PRIVATE_JWK` | `send`, `chat`, `register`                      |
| `PA_AUDIENCE`                 | `send`, `chat`                                  |
| `PA_USER_ID`                  | optional `sub`; default `demo-user`             |
| `PA_PLATFORM_NAME`            | optional name for `register`; default `demo-pa` |

The CLI also reads `reference/personal-agent/client/.env.local`. In this
workspace: `pnpm --filter @pac2/client pac2 <command>`.

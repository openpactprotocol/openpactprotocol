---
title: Reference implementation
description: Run the reference Provider, the demo PA, and the conformance suite in this repository.
---

Everything outside `docs/` is a runnable reference implementation of the
[specification](spec.md)'s **Identity** profile. Delegated authority (§5) is not
implemented here yet. Seed data, demo agents, and UI are not protocol. The
code and env vars call Brands `customers` (`CUSTOMER_ID`); that is the same
thing.

| Path                              | What it is                                                                                                       | Port |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---: |
| `reference/provider`              | Reference **Provider** (Next.js + PostgreSQL/PGlite): Agent Cards, JWT verification, `message:send`, task routes | 3000 |
| `reference/personal-agent/server` | Demo PA's **JWKS server** — a static `/.well-known/jwks.json`                                                    | 3002 |
| `reference/personal-agent/client` | Demo **PA UI** — one chat that fans out to Brands over PAC2, one `contextId` per Brand                           | 3001 |
| `packages/protocol`               | `@pac2/protocol` — Zod schemas for Agent Card, messages, errors, JWT claims                                      |      |
| `packages/client`                 | `@pac2/client` — signer, `discoverAgent`, `A2AClient`, `pac2` CLI                                                |      |
| `e2e/`                            | Conformance suite (live HTTP)                                                                                    |      |
| `website`                         | This site; content is in `docs/`                                                                                 | 3003 |

## Run it locally

Node 20+, pnpm 11.21.0.

```sh
pnpm install
pnpm gen-keys        # ES256 key pair: public → JWKS server, private → PA client .env.local
```

Four processes, in separate terminals:

```sh
pnpm --filter @pac2/personal-agent-server dev
PGLITE_DATA_DIR="$HOME/.local/share/pac2-provider-db" pnpm --filter @pac2/provider db:pglite
A2A_AUDIENCE=http://localhost:3000/a2a pnpm --filter @pac2/provider dev
pnpm --filter @pac2/personal-agent-client dev
```

Initialize the database once PGlite is up (any PostgreSQL works too — point
`DATABASE_URL` at it):

```sh
export DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres
export DATABASE_POOL_MAX=1
export PA_ISSUER=http://localhost:3002
pnpm --filter @pac2/provider db:migrate
pnpm --filter @pac2/provider db:seed
```

The seed creates three demo Brands and prints their IDs:

| Brand           | ID                           |
| --------------- | ---------------------------- |
| Skyline Airways | `01M3R53Q5SZQ6FQSMSDBSSREAA` |
| Loom & Co.      | `01M3R53Q5WKZ7A0GY4PZ8Y39TB` |
| Bloom & Stem    | `01M3R53Q5WHQ1APYDKBW3NCDG3` |

It also registers the PAs `demo-pa` (enabled) and `disabled-pa` (disabled).
`SEED_DEMO_PLATFORM=false` skips `demo-pa` so you can try self-service
registration.

Then configure the demo PA in `reference/personal-agent/client/.env.local`:

```dotenv
PROVIDER_URL=http://localhost:3000
CUSTOMER_IDS=01M3R53Q5SZQ6FQSMSDBSSREAA,01M3R53Q5WKZ7A0GY4PZ8Y39TB,01M3R53Q5WHQ1APYDKBW3NCDG3
PA_ISSUER=http://localhost:3002
PA_PLATFORM_NAME=demo-pa
PA_AUDIENCE=http://localhost:3000/a2a
PA_PRIVATE_JWK=<from pnpm gen-keys>
```

Open `http://localhost:3001` and chat. The `pac2` CLI reads the same
`.env.local` plus one `CUSTOMER_ID`.

## Provider

**Environment**

| Variable         | Purpose                                                                                                   |
| ---------------- | --------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`   | PostgreSQL connection URL (`DATABASE_POOL_MAX=1` with the local PGlite socket)                            |
| `A2A_AUDIENCE`   | Required. The audience given to PAs without a per-PA override                                             |
| `PA_ISSUER`      | Issuer used by the seed for `demo-pa` / `disabled-pa`                                                     |
| `PROVIDER_URL`   | Optional public base URL for Agent Card URLs; defaults to the request origin                              |
| `OPENAI_API_KEY` | Optional. With it, demo agents reply via OpenAI; without it, or on error/timeout, they use canned replies |
| `OPENAI_MODEL`   | Optional model name                                                                                       |

**Data model** — four tables: `customers` (Brands: ULID id, name),
`agent_platforms` (PAs: name, issuer, JWKS URI, enabled, optional audience —
`null` means `A2A_AUDIENCE`), `conversations` (UUID = `contextId`, Brand,
`{pa}:{sub}` owner), `messages` (parts and `messageId`, unique per
conversation).

**Demo agents** — each seeded Brand has one skill (flight status, order
status, flower orders) and a scripted multi-turn flow so `contextId`
continuation is visible. Fixture, not protocol.

### Self-service registration

The reference Provider onboards PAs through `POST {PROVIDER_URL}/api/platforms`.
The spec leaves onboarding to the Provider; others may do it out of band.

```sh
curl -X POST "$PROVIDER_URL/api/platforms" \
  -H "Authorization: Bearer $REGISTRATION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"my-pa","jwksUri":"https://pa.example.com/.well-known/jwks.json"}'
```

`REGISTRATION_TOKEN` is an ES256 JWT signed with the PA's own key:
`iss` = issuer, `sub` = `iss`, `aud` = the endpoint URL, `iat`/`exp` (≤ 300 s)
and `jti`. The JWKS URI must share the issuer's origin; both must be HTTPS
(HTTP allowed on `localhost`/`127.0.0.1`). `name` matches
`^[a-z0-9][a-z0-9-]{1,62}$`.

| Result | Meaning                                            |
| ------ | -------------------------------------------------- |
| `201`  | Registered and enabled; `{ "platform": … }`        |
| `200`  | Same issuer, name, and JWKS URI already registered |
| `409`  | Name or issuer already used with different details |
| `400`  | Invalid body or URL                                |
| `401`  | Missing or invalid assertion                       |

The registered PA gets the Provider's `A2A_AUDIENCE` as its audience.
`registerPlatform()` in `@pac2/client` and `pac2 register` wrap this call.

## Demo PA

`reference/personal-agent/client` signs requests server-side, discovers the
Brands in `CUSTOMER_IDS`, routes each User message to the right agent, and
keeps one context per Brand. Its history lives in
`.data/pa-conversations.json`; the Provider exposes none. With
`OPENAI_API_KEY` it runs a tool-calling loop (`contact_support_a2a`); without
it, keyword routing forwards the User's text verbatim. Its
**Register personal agent** panel calls the self-service endpoint above.

`reference/personal-agent/server` only serves the public JWKS; the private key
never leaves the client.

## Conformance tests

`e2e/` drives a running Provider over HTTP and checks the Identity profile:
card discovery, `contextId` continuation, duplicate `messageId`, cross-User
and cross-Brand isolation, task routes, error envelopes, content types,
unmatched routes, and every authentication negative.

```sh
PROVIDER_URL=http://localhost:3000 \
CUSTOMER_ID=01M3R53Q5SZQ6FQSMSDBSSREAA OTHER_CUSTOMER_ID=01M3R53Q5WKZ7A0GY4PZ8Y39TB \
PA_ISSUER=http://localhost:3002 PA_AUDIENCE=http://localhost:3000/a2a \
pnpm e2e
```

`PA_PRIVATE_JWK` comes from the environment or the PA client's `.env.local`.
To test **another Provider**, add `E2E_PROVIDER=any`: every protocol assertion
stays; only the reference Provider's seeded card text and canned replies are
skipped. `E2E_TEST_TIMEOUT_MS` (default 60000) bounds each test.

## Workspace checks

```sh
pnpm lint && pnpm typecheck && pnpm test && pnpm format:check
pnpm --filter @pac2/provider build
pnpm --filter @pac2/personal-agent-client build
pnpm --filter @pac2/docs build
```

## Deploying the reference stack

Three Vercel projects, all with root-directory builds:

| Project     | Root directory                    | Notes                                                                                                                       |
| ----------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Provider    | `reference/provider`              | Build `pnpm run vercel-build` (migrates, then `next build`); needs a PostgreSQL `DATABASE_URL`, `A2A_AUDIENCE`, `PA_ISSUER` |
| JWKS server | `reference/personal-agent/server` | Static; deploy before the Provider config that points at its issuer                                                         |
| Docs        | `website`                         | Default Next.js build; reads `docs/` from the repository root                                                               |

The root `packageManager` pins pnpm 11.21.0; set
`ENABLE_EXPERIMENTAL_COREPACK=1` if Vercel does not honor it. Run the
migration and seed against the deployed database once. The private PA key
belongs in the client or test runner, never in the Provider project.

---
title: Run the reference stack
description: Run the reference Provider, demo personal agent and conformance tests on your machine.
---

Everything outside `docs/` implements the [specification](spec.md)'s
**Identity** profile; it does not include delegated authority (§5). Seed data and
demo agents are examples, not protocol. The code calls Brands **customers**
(`CUSTOMER_ID`, the `customers` table).

| Path                              | What it is                                                            | Port |
| --------------------------------- | --------------------------------------------------------------------- | ---: |
| `reference/provider`              | Reference **Provider** (Next.js + PostgreSQL/PGlite)                  | 3000 |
| `reference/personal-agent/client` | Demo **personal-agent UI** — one chat fanning out to Brands over PACT | 3001 |
| `reference/personal-agent/server` | Demo personal agent's **JWKS server**                                 | 3002 |
| `packages/client`                 | `@openpactprotocol/client` — signer, `fetchAgentCard`, `A2AClient`    |      |
| `packages/protocol`               | `@openpactprotocol/protocol` — Zod schemas                            |      |
| `e2e/`                            | Conformance suite                                                     |      |
| `website`                         | This site; content is `docs/`                                         | 3003 |

## Run it locally

Node 20+ and pnpm 11.21.0.

```sh
pnpm install
pnpm gen-keys        # public key → JWKS server, private key → personal-agent client .env.local
```

Four processes, each in its own terminal:

```sh
pnpm --filter @openpactprotocol/personal-agent-server dev                                                 # JWKS, :3002
PGLITE_DATA_DIR="$HOME/.local/share/pact-provider-db" pnpm --filter @openpactprotocol/provider db:pglite  # database
A2A_AUDIENCE=http://localhost:3000/a2a pnpm --filter @openpactprotocol/provider dev                       # Provider, :3000
pnpm --filter @openpactprotocol/personal-agent-client dev                                                 # demo personal agent, :3001
```

Once the database is up (any PostgreSQL works; point `DATABASE_URL` at it).
Variables prefixed `PA_` (and the `-pa` ids) refer to the personal agent:

```sh
export DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres DATABASE_POOL_MAX=1 PA_ISSUER=http://localhost:3002
pnpm --filter @openpactprotocol/provider db:migrate && pnpm --filter @openpactprotocol/provider db:seed
```

The seed creates three Brands and onboards the demo personal agent (`demo-pa`):

| Brand           | ID                           |
| --------------- | ---------------------------- |
| Skyline Airways | `01M3R53Q5SZQ6FQSMSDBSSREAA` |
| Loom & Co.      | `01M3R53Q5WKZ7A0GY4PZ8Y39TB` |
| Bloom & Stem    | `01M3R53Q5WHQ1APYDKBW3NCDG3` |

Put them in `reference/personal-agent/client/.env.local`:

```dotenv
PROVIDER_URL=http://localhost:3000
CUSTOMER_IDS=01M3R53Q5SZQ6FQSMSDBSSREAA,01M3R53Q5WKZ7A0GY4PZ8Y39TB,01M3R53Q5WHQ1APYDKBW3NCDG3
PA_ISSUER=http://localhost:3002
PA_PLATFORM_NAME=demo-pa
PA_AUDIENCE=http://localhost:3000/a2a
PA_PRIVATE_JWK=<written by pnpm gen-keys>
```

Chat at `http://localhost:3001`. With `OPENAI_API_KEY` set on either side the
agents use OpenAI; without it they use scripted replies.

## Register a personal agent

The reference Provider onboards personal agents at `POST {PROVIDER_URL}/api/platforms`
(the spec leaves onboarding to each Provider):

```sh
curl -X POST "$PROVIDER_URL/api/platforms" \
  -H "Authorization: Bearer $REGISTRATION_TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"my-pa","jwksUri":"https://pa.example.com/.well-known/jwks.json"}'
```

`REGISTRATION_TOKEN` is a JWT signed with the personal agent's key: `iss` = issuer,
`sub` = `iss`, `aud` = the endpoint URL, `exp` ≤ 300 s. The JWKS URI must share
the issuer's origin. `201` registers (audience = `A2A_AUDIENCE`), `409` means
the name or issuer is taken. The demo personal agent's **Register** button makes this call.

## Conformance tests

```sh
PROVIDER_URL=http://localhost:3000 \
CUSTOMER_ID=01M3R53Q5SZQ6FQSMSDBSSREAA OTHER_CUSTOMER_ID=01M3R53Q5WKZ7A0GY4PZ8Y39TB \
PA_ISSUER=http://localhost:3002 PA_AUDIENCE=http://localhost:3000/a2a \
pnpm e2e
```

`PA_PRIVATE_JWK` comes from the environment or the personal-agent client's `.env.local`.
Against another Provider add `E2E_PROVIDER=any`, which skips only the
reference Provider's seeded card text and canned replies.
`E2E_TEST_TIMEOUT_MS` (default 60000) bounds each test.

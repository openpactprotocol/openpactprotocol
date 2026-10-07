---
title: Run the reference stack
description: Run the reference Provider, demo personal agent and conformance tests on your machine.
---

Everything outside `docs/` implements the [specification](./spec.md)'s
**Identity** profile. Delegated authority (§5) is opt-in: see
[Delegated authority](#delegated-authority-optional). Example implementations
and seed data are provided as reference. The code calls Brands **customers**
(`CUSTOMER_ID`, the `customers` table).

These apps are local demos, not production-ready services. The Brand app uses
fixed demo credentials and in-memory account data. Before deploying publicly,
replace demo authentication, add rate limits, and restrict outbound JWKS requests
to public IP addresses after DNS resolution.

| Path                              | What it is                                                           | Port |
| --------------------------------- | -------------------------------------------------------------------- | ---: |
| `reference/provider`              | Reference **Provider** (Next.js + PostgreSQL/PGlite)                 | 3000 |
| `reference/personal-agent/client` | Demo **personal-agent UI**: one chat fanning out to Brands over PACT | 3001 |
| `reference/personal-agent/server` | Demo personal agent's **JWKS server**                                | 3002 |
| `reference/brand`                 | Example **Brand** app (Skyline login, accounts, API) for §5          | 3004 |
| `packages/client`                 | `@openpactprotocol/client`: signer, `fetchAgentCard`, `A2AClient`    |      |
| `packages/protocol`               | `@openpactprotocol/protocol`: Zod schemas                            |      |
| `e2e/`                            | Conformance suite                                                    |      |

<a name="run-it-locally"></a>

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
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres DATABASE_POOL_MAX=1 \
A2A_AUDIENCE=http://localhost:3000/a2a pnpm --filter @openpactprotocol/provider dev                       # Provider, :3000
pnpm --filter @openpactprotocol/personal-agent-client dev                                                 # demo personal agent, :3001
```

`DATABASE_POOL_MAX=1` matters: PGlite is a single-session database, so with
the default pool of 5 the Provider's connections interleave and it fails with
`prepared statement "" requires N parameters`.

Once the database is up, migrate and seed it. Any PostgreSQL works; point
`DATABASE_URL` at it. `PA_` variables and `-pa` ids refer to the personal agent:

```sh
export DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres DATABASE_POOL_MAX=1 PA_ISSUER=http://localhost:3002
pnpm --filter @openpactprotocol/provider db:migrate && pnpm --filter @openpactprotocol/provider db:seed
```

The seed creates three Brands and registers the demo personal agent (`demo-pa`):

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

<a name="delegated-authority-optional"></a>

## Delegated authority (optional)

With `DELEGATION_ENABLED=1` on the Provider, Skyline Airways' card also offers
OAuth 2.0 device-code delegation (§5) with three scopes:
`flights:upcoming:read`, `flights:history:read` and `flights:rebook`. The other
Brands stay Identity-only. Without the variable, nothing changes.

Roles follow the spec: the Provider is the authorization server (device and token
endpoints, consent page, signing key, token checks on every message). The Brand
app owns login, accounts and the account API. After login it posts a signed,
single-use assertion (keys at `{BRAND_URL}/.well-known/jwks.json`) to the
Provider's consent page.

Start the Brand app and restart the Provider with delegation on:

```sh
pnpm --filter @openpactprotocol/brand dev                                                   # Skyline Brand, :3004
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres DATABASE_POOL_MAX=1 \
DELEGATION_ENABLED=1 A2A_AUDIENCE=http://localhost:3000/a2a pnpm --filter @openpactprotocol/provider dev
```

| Variable               | Where            | Default                 |
| ---------------------- | ---------------- | ----------------------- |
| `DELEGATION_ENABLED`   | Provider         | off                     |
| `BRAND_URL`            | both             | `http://localhost:3004` |
| `BRAND_PUBLIC_URL`     | Provider         | `BRAND_URL`             |
| `CONSENT_ORIGIN`       | Provider + Brand | Provider URL            |
| `PROVIDER_URL`         | Provider + Brand | `http://localhost:3000` |
| `PROVIDER_PRIVATE_JWK` | Provider         | generated into `.data/` |
| `BRAND_PRIVATE_JWK`    | Brand            | generated into `.data/` |

<a name="demo-hostnames"></a>

### Demo hostnames

For browser-facing demo URLs that look like a production deployment, start the
Provider with:

```sh
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres DATABASE_POOL_MAX=1 \
PROVIDER_URL=http://localhost:3000 CONSENT_ORIGIN=http://auth.skyline.localhost:3000 BRAND_PUBLIC_URL=http://skyline.localhost:3004 \
DELEGATION_ENABLED=1 A2A_AUDIENCE=http://localhost:3000/a2a pnpm --filter @openpactprotocol/provider dev
```

Start the Brand with:

```sh
CONSENT_ORIGIN=http://auth.skyline.localhost:3000 pnpm --filter @openpactprotocol/brand dev
```

Then open `http://agent.localhost:3001`. This mirrors production, where consent
is served by the Provider on a Brand subdomain ([Provider guide](./provider.md)).

In the demo personal agent, ask "Can you check my upcoming Skyline flight?".
Skyline replies `TASK_STATE_AUTH_REQUIRED`, and the agent shows a **Sign in with Skyline Airways** card that opens the Brand login in a new tab (demo account
`alex.rivera@example.com` / `skyline`). Choose scopes on the consent page; the
agent polls the token endpoint, re-sends the message with
`X-A2A-User-Delegation`, and shows the signed receipt on the Skyline thread.
Asking to rebook without `flights:rebook` triggers step-up.

Skyline also advertises the example resource-bound rebooking type from
[spec §5.7](./spec.md#57-resource-bound-delegation). Request it with
`DeviceCodeClient.start` as shown in the
[personal-agent guide](./personal-agent.md#resource-bound-delegation). Consent
shows the reservation and target flight, refresh preserves those conditions,
and the Brand API rejects rebooking requests for any other pair. The chat UI
continues to request scope-only grants.

Delegated conformance tests (skipped when the card has no delegation):

```sh
pnpm --filter @openpactprotocol/e2e test:delegated
```

<a name="register-a-personal-agent"></a>

## Register a personal agent

The reference Provider registers personal agents at `POST {PROVIDER_URL}/api/platforms`
(the spec leaves registration to each Provider):

```sh
curl -X POST "$PROVIDER_URL/api/platforms" \
  -H "Authorization: Bearer $REGISTRATION_TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"my-pa","jwksUri":"https://pa.example.com/.well-known/jwks.json"}'
```

`REGISTRATION_TOKEN` is a JWT signed with the personal agent's key: `iss` = issuer,
`sub` = `iss`, `aud` = the endpoint URL, `exp` ≤ 300 s. The JWKS URI must share
the issuer's origin. `201` registers (audience = `A2A_AUDIENCE`), `409` means
the name or issuer is taken. The demo personal agent's **Register** button makes this call.

<a name="conformance-tests"></a>

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

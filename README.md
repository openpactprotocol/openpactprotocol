# Personal Agent Protocol · Phase 1 harness

An internal end-to-end test harness for the A2A 1.0 HTTP+JSON agent channel. The provider is a deliberately small Decagon-like dummy FAQ agent, and the personal-agent (PA) app signs platform JWTs server-side. Nothing in this repository is a public product or a general-purpose service.

The hand-written protocol dispatcher follows the A2A 1.0.0 proto and specification provided with this repository's initial implementation brief. Proto field names and enum spellings are authoritative; in particular, AgentCard uses `securityRequirements`.

## Repository layout

- `apps/provider`: Next.js App Router provider, PostgreSQL persistence, A2A dispatcher, and FAQ agent.
- `apps/personal-agent/server`: static Vercel site serving the PA platform public JWKS.
- `apps/personal-agent/client`: local-only Next.js chat UI. Private-key signing happens only in server components/actions.
- `packages/protocol`: Zod schemas, HTTP error definitions, and A2A constants.
- `packages/client`: reference client, JWT signer, and `pap` CLI.
- `scripts/gen-keys.ts`: local ES256 key generation.
- `e2e`: Vitest end-to-end suite for an already-running provider and JWKS server.

All workspaces are strict TypeScript/ESM, and the workspace packages export TypeScript source for Next's `transpilePackages`.

## Provider data model

The provider stores only the protocol core in five tables:

- `customers`: UUIDv7 `id` (primary key), unique `slug`, unique `name`.
- `agent_platforms`: `id`, unique `name`, unique `issuer`, `jwks_uri`, `enabled`.
- `conversations`: `id` (the A2A task ID), `customer_id`, `user_id` (`{platform}:{sub}`), `state`, `metadata` (JSONB default `{}`), `created_at`, `updated_at`. The ownership index is `(customer_id, user_id, updated_at)`. Metadata stores the optional A2A `contextId` and FAQ `flow`.
- `messages`: `id`, `conversation_id`, `message_id`, `role`, `parts` (JSONB), `created_at`; message IDs are unique within a conversation.
- `seen_jtis`: `platform_id`, `jti`, and `expires_at`, keyed by `(platform_id, jti)` for replay protection.

The dummy agent has one static FAQ skill. Known hours, location, parking, or insurance topics complete immediately. Unrecognized questions ask the user to pick a topic and can be continued on the same task; requests for a human get an `INPUT_REQUIRED` follow-up response.

A2A context IDs are optional. The provider preserves and echoes a context ID when supplied; tasks without one omit the `contextId` field from Task and Message responses.

## A2A HTTP+JSON binding

The Agent Card advertises the per-customer interface base URL `{PROVIDER_URL}/a2a/{slug}` and `protocolBinding: "HTTP+JSON"`. All JWTs use that exact interface URL as `aud`, regardless of the operation. Authenticated requests include `A2A-Version: 1.0`; request bodies may use `application/json` or `application/a2a+json`, and responses use `application/json`.

| Method                  | Path relative to the interface URL         | Behavior                                                                                                                               |
| ----------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`                   | `.well-known/agent-card.json`              | Public Agent Card; unknown customer slugs return 404.                                                                                  |
| `POST`                  | `message:send`                             | Send a message; returns HTTP 200 `{ "task": ... }`.                                                                                    |
| `POST`                  | `message:stream`                           | Returns `UNSUPPORTED_OPERATION`.                                                                                                       |
| `GET`                   | `tasks/{id}`                               | Returns the Task; supports `historyLength`.                                                                                            |
| `GET`                   | `tasks`                                    | Lists Tasks; supports `contextId`, `status`, `pageSize`, `pageToken`, `historyLength`, `statusTimestampAfter`, and `includeArtifacts`. |
| `POST`                  | `tasks/{id}:cancel`                        | Returns `TASK_NOT_CANCELABLE` for owned tasks.                                                                                         |
| `GET`, `POST`           | `tasks/{id}:subscribe`                     | Returns `UNSUPPORTED_OPERATION`.                                                                                                       |
| `GET`, `POST`, `DELETE` | `tasks/{id}/pushNotificationConfigs[/...]` | Returns `UNSUPPORTED_OPERATION`.                                                                                                       |
| `GET`                   | `extendedAgentCard`                        | Returns `EXTENDED_AGENT_CARD_NOT_CONFIGURED`.                                                                                          |

Unknown paths or unsupported methods return an empty-body 404 before authentication. Matched A2A operations authenticate first; invalid credentials return an empty-body 401 before request bodies are read.

Errors use the AIP-193 shape `{"error":{"code":<HTTP status>,"status":"<gRPC status>","message":"...","details":[{"@type":"type.googleapis.com/google.rpc.ErrorInfo","reason":"...","domain":"a2a-protocol.org"}]}}`.

| Reason                               | HTTP status | Status                |
| ------------------------------------ | ----------: | --------------------- |
| `TASK_NOT_FOUND`                     |         404 | `NOT_FOUND`           |
| `TASK_NOT_CANCELABLE`                |         409 | `FAILED_PRECONDITION` |
| `UNSUPPORTED_OPERATION`              |         400 | `UNIMPLEMENTED`       |
| `CONTENT_TYPE_NOT_SUPPORTED`         |         415 | `INVALID_ARGUMENT`    |
| `EXTENDED_AGENT_CARD_NOT_CONFIGURED` |         400 | `FAILED_PRECONDITION` |
| `VERSION_NOT_SUPPORTED`              |         400 | `UNIMPLEMENTED`       |
| `INVALID_ARGUMENT`                   |         400 | `INVALID_ARGUMENT`    |
| `INTERNAL`                           |         500 | `INTERNAL`            |

To call the send route directly, sign a fresh JWT whose audience is the interface URL, then send:

```sh
curl -X POST "$PROVIDER_URL/a2a/$CUSTOMER_SLUG/message:send" \
  -H "Authorization: Bearer $TOKEN" \
  -H "A2A-Version: 1.0" \
  -H "Content-Type: application/json" \
  -d '{"message":{"messageId":"message-1","role":"ROLE_USER","parts":[{"text":"What are your hours?"}]}}'
```

The reference client signs each request and the CLI commands remain:

```sh
pnpm --filter @pap/client pap card
pnpm --filter @pap/client pap send "what are your hours?"
pnpm --filter @pap/client pap send "hours" --task <task-id>
pnpm --filter @pap/client pap get <task-id>
pnpm --filter @pap/client pap list
pnpm --filter @pap/client pap cancel <task-id>
pnpm --filter @pap/client pap chat
```

## Local development

Requirements: Node.js 20+, pnpm 11.21.0, and PostgreSQL (a local database or a Neon development branch).

```sh
pnpm install
pnpm gen-keys
```

`pnpm gen-keys` writes the public JWK to `apps/personal-agent/server/public/.well-known/jwks.json` and the private JWK to `apps/personal-agent/client/.env.local`. The private file is gitignored. Do not commit a locally generated JWKS: the deployment owner should run the command and commit their own public key.

Start the three local processes in separate terminals:

```sh
pnpm --filter @pap/personal-agent-server dev
pnpm --filter @pap/provider dev
pnpm --filter @pap/personal-agent-client dev
```

These listen on ports 3002, 3000, and 3001. Once the local JWKS server is available, configure a database and initialize it:

```sh
export DATABASE_URL=postgres://localhost:5432/pap
PA_ISSUER=http://localhost:3002 pnpm --filter @pap/provider db:migrate
PA_ISSUER=http://localhost:3002 pnpm --filter @pap/provider db:seed
```

If PostgreSQL is not installed, use the persistent PGlite PostgreSQL-wire server instead:

```sh
pnpm --filter @pap/provider db:pglite
# In another terminal:
export DATABASE_POOL_MAX=1
export DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres
PA_ISSUER=http://localhost:3002 pnpm --filter @pap/provider db:migrate
PA_ISSUER=http://localhost:3002 pnpm --filter @pap/provider db:seed
```

The PGlite database is stored at `~/.local/share/pap-provider-db` by default and listens on port 5432. The socket adapter has limited support for concurrent clients, so use one provider connection locally; the default pool size remains five for PostgreSQL.

The seed creates Acme Health and Globex Clinic customers, plus `demo-pa` (enabled) and `disabled-pa` (disabled) platforms. Seed output prints both customer slugs. Set `PROVIDER_URL=http://localhost:3000` and `CUSTOMER_SLUG` to Acme Health's printed slug in `apps/personal-agent/client/.env.local`, then open `http://localhost:3001`.

To use the CLI, run from the repository root:

```sh
pnpm --filter @pap/client pap card
pnpm --filter @pap/client pap send "what are your hours?"
```

## Tests and checks

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm format:check
pnpm --filter @pap/provider build
pnpm --filter @pap/personal-agent-client build
pnpm e2e
```

The E2E suite expects a running provider and JWKS server. Configure:

- `PROVIDER_URL`: provider base URL (defaults to `http://localhost:3000`).
- `CUSTOMER_SLUG`: Acme Health slug printed by the provider seed.
- `GLOBEX_SLUG`: Globex Clinic slug printed by the provider seed; used to verify wrong-audience rejection.
- `PA_ISSUER`: issuer URL used when seeding the provider and registering the PA platform.
- `PA_PRIVATE_JWK`: local private JWK. If not exported, the suite reads `apps/personal-agent/client/.env.local`.

The suite covers card discovery, FAQ answers and multi-turn clarification, task ownership/pagination, protocol errors, and platform JWT rejection cases.

The provider's `build` does not touch the database. `vercel-build` applies migrations before running `next build`.

## Deployment

Create two Vercel projects:

1. **Provider** — Root Directory `apps/provider`; set the Build Command to `pnpm run vercel-build`, which runs migrations before `next build`. Attach a Neon database through the Vercel Marketplace so `DATABASE_URL` is injected. Deploy in a region close to the database (`apps/provider/vercel.json` defaults to `iad1`).
2. **Personal-agent server** — Root Directory `apps/personal-agent/server`; it is a static public directory with no build step. Commit the PA owner's public `jwks.json` before deployment.

Vercel must use pnpm 11.21.0, matching the root `packageManager` field. If Vercel detects a different pnpm version, set the project environment variable `ENABLE_EXPERIMENTAL_COREPACK=1` so Corepack honors the pinned version.

Set provider environment variables `DATABASE_URL` and `PA_ISSUER`; optionally set `PROVIDER_URL`. After `vercel env pull`, run the provider seed against the intended database and production `PA_ISSUER`. The seed output prints the `CUSTOMER_SLUG` for Acme Health and `GLOBEX_SLUG` for Globex Clinic. Keep Standard Deployment Protection enabled. The JWKS endpoint includes JSON content type, CORS, and a five-minute public cache.

For production E2E, configure `PROVIDER_URL`, the two customer slugs from the seed output, `PA_ISSUER`, and `PA_PRIVATE_JWK` on a trusted runner. Keep the private JWK on that runner; never add it to the provider project.

## Open deployment questions

- Which Vercel team/scope should own these internal projects?
- Should the projects be created through the Vercel CLI or Git integration?
- Are the suggested project names `pap-provider` and `pap-personal-agent` acceptable?

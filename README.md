# Personal Agent Protocol · Phase 1 harness

An internal end-to-end test harness for the A2A 1.0 JSON-RPC agent channel. The provider is a deliberately small Decagon-like dummy agent, and the personal-agent (PA) app signs platform JWTs server-side. Nothing in this repository is a public product or a general-purpose service.

The hand-written protocol dispatcher follows the A2A 1.0.0 proto and specification provided with this repository's initial implementation brief. Proto field names and enum spellings are authoritative; in particular, AgentCard uses `securityRequirements`.

## Repository layout

- `apps/provider`: Next.js App Router provider, PostgreSQL persistence, A2A dispatcher, agent card, and Basic-auth admin.
- `apps/personal-agent/server`: static Vercel site serving the PA platform public JWKS.
- `apps/personal-agent/client`: local-only Next.js chat UI. Private-key signing happens only in server components/actions.
- `packages/protocol`: Zod schemas and A2A constants.
- `packages/client`: reference client, JWT signer, and `pap` CLI.
- `scripts/gen-keys.ts`: local ES256 key generation.
- `e2e`: Vitest end-to-end suite for an already-running provider and JWKS server.

All workspaces are strict TypeScript/ESM, and the workspace packages export TypeScript source for Next's `transpilePackages`.

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

Set `PROVIDER_URL=http://localhost:3000` and `CUSTOMER_SLUG` to the printed Acme Health slug in `apps/personal-agent/client/.env.local`. The client uses the private key and issuer from that file. Open `http://localhost:3001`.

To use the CLI, run from the repository root:

```sh
pnpm --filter @pap/client pap card
pnpm --filter @pap/client pap send "what are your hours?"
```

`ADMIN_USER` and `ADMIN_PASSWORD` protect `/admin`; unset credentials intentionally make the admin unavailable (503). The development customer seed includes Acme Health and a disabled Globex Clinic customer for negative cases. Seed output gives the slugs.

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

The E2E suite expects a running provider and JWKS server. Configure `PROVIDER_URL`, `CUSTOMER_SLUG`, `DISABLED_CUSTOMER_SLUG`, `PA_ISSUER`, `PA_PRIVATE_JWK`, `ADMIN_USER`, and `ADMIN_PASSWORD`. If `PA_PRIVATE_JWK` is not exported, the suite reads `apps/personal-agent/client/.env.local`. E2E burst testing runs last because it intentionally exercises the global per-platform rate limit. Re-running the suite within the same minute can also encounter the configured limit.

The provider's `build` does not touch the database. `vercel-build` applies migrations before running `next build`.

## Deployment

Create two Vercel projects:

1. **Provider** — Root Directory `apps/provider`; use the `vercel-build` build command. Attach a Neon database through the Vercel Marketplace so `DATABASE_URL` is injected. Deploy in a region close to the database (`apps/provider/vercel.json` defaults to `iad1`).
2. **Personal-agent server** — Root Directory `apps/personal-agent/server`; it is a static public directory with no build step. Commit the PA owner's public `jwks.json` before deployment.

Set provider environment variables `DATABASE_URL`, `ADMIN_USER`, `ADMIN_PASSWORD`, and `PA_ISSUER`; optionally set `PROVIDER_URL` and `A2A_SEND_MESSAGE_LIMIT_PER_MINUTE` (default 20). After `vercel env pull`, run the provider seed against the intended database and production `PA_ISSUER`. Keep Standard Deployment Protection enabled. The JWKS endpoint includes JSON content type, CORS, and a five-minute public cache.

For production E2E, set the same E2E environment variables to the deployed provider, PA server, and seeded customer slugs. Do not add the private key to the provider project.

## Open deployment questions

- Which Vercel team/scope should own these internal projects?
- Should the projects be created through the Vercel CLI or Git integration?
- Are the suggested project names `pap-provider` and `pap-personal-agent` acceptable?

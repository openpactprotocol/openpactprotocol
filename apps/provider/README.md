# Provider

The provider is a Next.js App Router service with the customer support A2A
endpoint, platform authentication, and a small FAQ agent. See the
[operations reference](../../apps/docs/content/reference/operations.md) and
[authentication guide](../../apps/docs/content/guides/authentication.md) for
the wire contract.

## Data model

The initial migration creates four tables:

- `customers`: text ULID primary key and unique display name.
- `agent_platforms`: registered platform name, issuer, JWKS URI, enabled flag,
  and optional audience. A null audience means `{PROVIDER_URL}/a2a`.
- `conversations`: UUID primary key used as `contextId`, customer and
  `{platform}:{sub}` owner, optional FAQ flow metadata, and timestamps.
- `messages`: stored user and agent messages with JSON parts and message IDs
  unique within a conversation.

The seed is idempotent by customer name. It creates Acme Health and Globex
Clinic, `demo-pa` enabled, and `disabled-pa` disabled. Set
`SEED_DEMO_PLATFORM=false` to omit the demo platform while retaining the
disabled platform.

## Environment

- `DATABASE_URL`: PostgreSQL connection URL.
- `PA_ISSUER`: issuer for the seeded PA platform.
- `PROVIDER_URL`: optional public provider URL used for card URLs and the
  default runtime JWT audience.
- `DATABASE_POOL_MAX`: use `1` with the local PGlite socket.

Run `pnpm --filter @pap/provider db:migrate` and
`pnpm --filter @pap/provider db:seed`. Local database and stack setup is in the
[local development guide](../../docs/local-development.md).

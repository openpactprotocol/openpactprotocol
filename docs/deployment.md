# Deployment

The harness uses three Vercel projects:

1. **Provider** — root directory `apps/provider`; build command
   `pnpm run vercel-build`, which applies migrations before `next build`.
   Configure a PostgreSQL database (for example, Neon) and deploy in a region
   close to it. `apps/provider/vercel.json` defaults to `iad1`.
2. **PA JWKS server** — root directory `apps/personal-agent/server`; serves the
   platform's public JWKS as a static site and has no database or build step.
   Publish the public key before deploying the provider configuration that
   points to its issuer.
3. **Developer docs** — root directory `apps/docs`; use Vercel's default
   Next.js build with no environment variables.

The root `packageManager` pins pnpm to 11.21.0. If Vercel does not honor the
pin through Corepack, set `ENABLE_EXPERIMENTAL_COREPACK=1`.

## Environment and initialization

Configure the provider with:

- `DATABASE_URL`: PostgreSQL connection URL.
- `PA_ISSUER`: platform issuer used by the seed for `demo-pa` and `disabled-pa`.
- `PROVIDER_URL`: optional public provider base URL; when unset, the provider
  derives it from the request or Vercel production URL.

After deployment, apply the migration and run the provider seed against the
intended database. It seeds Skyline Airways (`01M3R53Q5SZQ6FQSMSDBSSREAA`),
Loom & Co. (`01M3R53Q5WKZ7A0GY4PZ8Y39TB`), and Bloom & Stem
(`01M3R53Q5WHQ1APYDKBW3NCDG3`). Protect the private PA key: it belongs in the trusted client or
test runner, never in the provider project. Public JWKS files contain only
public keys.

The local PA client accepts these IDs in its `CUSTOMER_IDS` comma-separated
setting. The protocol CLI continues to use `CUSTOMER_ID` for one business.

Set `SEED_DEMO_PLATFORM=false` when seeding an environment intended to
demonstrate self-service platform registration. The disabled platform is
still seeded. See the [authentication guide](../apps/docs/content/guides/authentication.md)
for runtime audiences and [registration guide](../apps/docs/content/guides/registration.md)
for assertions.

## Open deployment questions

- Which Vercel team/scope should own these internal projects?
- Should the projects be created through the Vercel CLI or Git integration?
- Are `pac2-provider`, `pac2-personal-agent`, and `pac2-docs` acceptable project
  names?

The local PA client is a development harness and is not a Vercel project.

# PAC2 harness

PAC2 (Personal Agent Customer Connector Protocol; name TBD) lets a personal
agent platform such as Instinct call a customer's support agent over A2A 1.0
HTTP+JSON. The platform proves its identity with a signed JWT, while customer
conversations remain anonymous and continue through a context ID.

## How it works

1. Register the personal-agent platform with the provider.
2. Discover the customer's public A2A Agent Card.
3. Send a signed `message:send` request to the customer's agent.
4. Continue the conversation by sending its returned `contextId`.

## This repo contains

- [Developer docs](apps/docs/README.md) — PAC2 integration guides, protocol reference, and docs-site development.
- [Provider](apps/provider/README.md) — customer support agent, platform auth, and persistence.
- [PA JWKS server](apps/personal-agent/server/README.md) — serves the platform's public signing keys.
- [PA client](apps/personal-agent/client/README.md) — local chat UI and conversation history.
- [Protocol package](packages/protocol/README.md) — shared A2A and registration schemas.
- [Reference client and CLI](packages/client/README.md) — platform signer, A2A client, and `pac2`.
- [E2E suite](e2e/README.md) — live HTTP checks for the local harness.

## Quick start

1. Install dependencies and generate local keys: `pnpm install && pnpm gen-keys`.
2. Start JWKS, PGlite, provider, and PA client; see the [local development guide](docs/local-development.md).
3. Run provider migrations and seed the local customer IDs.
4. Set `CUSTOMER_ID` and local signing values in the PA client's ignored `.env.local`.
5. Open `http://localhost:3001`, register the platform if needed, and start a chat.

See [deployment notes](docs/deployment.md) for the Vercel setup.

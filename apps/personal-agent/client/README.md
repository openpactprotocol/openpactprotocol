# PA client

The local Next.js UI is a personal-agent platform client. It signs requests
server-side, discovers configured businesses, routes each phone message to
their support agents, and provides a platform registration panel. See the
[registration guide](../../../apps/docs/content/guides/registration.md) and
[messaging guide](../../../apps/docs/content/guides/messaging.md) for the wire
contract.

## Conversations

The provider does not expose conversation history. This client persists one
phone conversation and its separate per-business A2A threads in the ignored
file `apps/personal-agent/client/.data/pa-conversations.json`. Entries are
scoped to the user ID and provider URL, and sorted newest first. Changing the
anonymous user ID shows an empty conversation list.

## Environment

Use `.env.local` for local configuration; `.env.example` lists the supported
variables:

- `PROVIDER_URL`: provider base URL.
- `CUSTOMER_IDS`: comma-separated customer ULIDs used for discovery and message
  routing. The local demo seeds Skyline Airways, Loom & Co., and Bloom & Stem.
- `PA_ISSUER` and `PA_PRIVATE_JWK`: platform identity and signing key.
- `PA_PLATFORM_NAME`: optional platform registration name; defaults to
  `demo-pa`.
- `PA_AUDIENCE`: optional runtime audience override.
- `OPENAI_API_KEY`: optional key for LLM-assisted business routing.
- `OPENAI_MODEL`: optional model name; defaults to `gpt-6-luna`.

The **Register personal agent** panel proves key control and registers the
platform with the provider. The header's **Signing as** identity displays the
active platform. For startup and seeding, see the [local development
guide](../../../docs/local-development.md).

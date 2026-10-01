# PACT — Personal Agent Consent & Trust Protocol

PACT extends [A2A 1.0](https://a2a-protocol.org) with the two things A2A leaves
open: **which PA is calling**, and **what the User allowed**.

| Term         | Meaning                                                         |
| ------------ | --------------------------------------------------------------- |
| **Provider** | Builds and hosts Brands' support agents.                        |
| **Brand**    | A business whose agent runs on a Provider.                      |
| **PA**       | A personal-agent platform. Signs its requests with its own key. |
| **User**     | The person using the PA.                                        |

```text
 User ──▶ PA ──A2A over HTTPS──▶ Provider ──▶ Brand's agent
              JWT {iss, sub, aud}         verifies via JWKS · mints contextId
              delegation token (optional) checks scopes · signs receipts

 once, per Provider
    onboard     publish JWKS; Provider records issuer, assigns your audience

 per User
 1. discover    GET  /a2a/{brandId}/.well-known/agent-card.json  → interface URL (+ Brand's scopes)
 2. send        POST {interfaceUrl}/message:send + Bearer JWT     → reply + contextId
 3. continue    same call with contextId
 4. authorize   only if the card offers it: OAuth device code → delegation token → send it too
```

## Docs

| Read                                                         | To                                                                  |
| ------------------------------------------------------------ | ------------------------------------------------------------------- |
| [Introduction](docs/index.md)                                | see the terms, the two layers, the calls                            |
| [Quickstart](docs/quickstart.md)                             | send a message with curl or TypeScript                              |
| [**Specification**](docs/spec.md)                            | implement a PA or a Provider — the normative text                   |
| [Reference implementation](docs/reference-implementation.md) | run the Provider, demo PA, and conformance suite (Identity profile) |
| [TypeScript client](docs/typescript-client.md)               | use `@pact/client` and the `pact` CLI                               |

Rendered at the docs site (`website/`).

## In this repository

```text
docs/                      the pages above (single source for the site)
packages/protocol          @pact/protocol — Zod schemas: Agent Card, messages, errors, JWT claims
packages/client            @pact/client   — signer, discoverAgent, A2AClient, `pact` CLI
reference/provider         reference Provider (Next.js + PostgreSQL)
reference/personal-agent/  demo PA: JWKS server + chat UI
e2e/                       conformance suite — run against any Provider with E2E_PROVIDER=any
website/                   docs-site renderer
```

Only `docs/spec.md` is normative.

## Run it

```sh
pnpm install && pnpm gen-keys
```

then [Reference implementation → Run it locally](docs/reference-implementation.md#run-it-locally).

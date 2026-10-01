# PACT — Personal Agent Consent & Trust Protocol

PACT lets a personal agent contact a business's support agent with a
verifiable identity (**Trust**) and, optionally, only the permissions the user
granted (**Consent**). It's a profile of [A2A 1.0](https://a2a-protocol.org).

Today, personal agents reach businesses by driving chat widgets like anonymous
browsers. With PACT, the business knows which agent is calling, and the user
can let it act on their account without ever giving it their password.

## Docs

| Read                                                         | To                                                         |
| ------------------------------------------------------------ | ---------------------------------------------------------- |
| [Introduction](docs/index.md)                                | understand who's involved and how it works                 |
| [Quickstart](docs/quickstart.md)                             | send your first message                                    |
| [**Specification**](docs/spec.md)                            | implement a PA or a Provider (the only normative document) |
| [Reference implementation](docs/reference-implementation.md) | run the Provider, demo PA and conformance tests            |
| [TypeScript client](docs/typescript-client.md)               | use `@pact/client` and the `pact` CLI                      |

The docs site in `website/` renders these pages.

## In this repository

```text
docs/                      the pages above (single source for the site)
packages/protocol          @pact/protocol — Zod schemas: Agent Card, messages, errors, JWT claims
packages/client            @pact/client   — signer, discoverAgent, A2AClient, `pact` CLI
reference/provider         reference Provider (Next.js + PostgreSQL)
reference/personal-agent/  demo PA: JWKS server + chat UI
e2e/                       conformance tests — run against any Provider with E2E_PROVIDER=any
website/                   docs-site renderer
```

## Run it

```sh
pnpm install && pnpm gen-keys
```

then follow [Reference implementation → Run it locally](docs/reference-implementation.md#run-it-locally).

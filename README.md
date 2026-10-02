# Personal Agent Consent & Trust (PACT)

PACT lets a personal agent contact a Brand's support agent with a verifiable
identity (**Trust**) and, optionally, only the permissions the User granted
(**Consent**). PACT is a new protocol built on [A2A 1.0](https://a2a-protocol.org).

| Term               | Meaning                                                                    |
| ------------------ | -------------------------------------------------------------------------- |
| **User**           | The person.                                                                |
| **Personal agent** | The agent platform acting for the User.                                    |
| **Brand**          | A business the User wants help from. Its support agent runs on a Provider. |
| **Provider**       | Builds and hosts support agents for many Brands.                           |

![PACT at a glance](docs/images/protocol-overview.svg)

## Start here

| You are                   | Read                                                         |
| ------------------------- | ------------------------------------------------------------ |
| New to PACT               | [Introduction](docs/index.md) — what it is and how it works  |
| Building a personal agent | [Build a personal agent integration](docs/personal-agent.md) |
| Building a Provider       | [Build a Provider](docs/provider.md)                         |
| Checking the rules        | [Specification](docs/spec.md) — the normative text           |
| Trying it on your machine | [Run the reference stack](docs/running.md)                   |

[AGENTS.md](AGENTS.md) points coding agents at the right guide.

## In this repository

```text
docs/                      the pages above (single source for the site)
packages/protocol          @openpactprotocol/protocol — Zod schemas: Agent Card, messages, errors, JWT claims
packages/client            @openpactprotocol/client   — personal-agent client: signer, fetchAgentCard, A2AClient (one file)
reference/provider         reference Provider (Next.js + PostgreSQL)
reference/personal-agent/  demo personal agent: JWKS server + chat UI
e2e/                       conformance tests — run against any Provider with E2E_PROVIDER=any
website/                   docs-site renderer
```

## Run it

```sh
pnpm install && pnpm gen-keys
```

then follow [Run the reference stack](docs/running.md#run-it-locally).

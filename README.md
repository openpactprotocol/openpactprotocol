# Personal Agent Consent & Trust (PACT)

PACT lets a personal agent contact a Brand's support agent with a verifiable
identity (**Trust**) and, optionally, only the permissions the User granted
(**Consent**). PACT is a new protocol built on [A2A 1.0](https://a2a-protocol.org).

| Term         | Meaning                                                                    |
| ------------ | -------------------------------------------------------------------------- |
| **User**     | The person.                                                                |
| **PA**       | The personal-agent platform acting for the User.                           |
| **Brand**    | A business the User wants help from. Its support agent runs on a Provider. |
| **Provider** | Builds and hosts support agents for many Brands.                           |

## Start here

| You are                   | Read                                               |
| ------------------------- | -------------------------------------------------- |
| Building a PA             | [Build a PA integration](docs/pa.md)               |
| Building a Provider       | [Build a Provider](docs/provider.md)               |
| Checking the rules        | [Specification](docs/spec.md) — the normative text |
| Trying it on your machine | [Run the reference stack](docs/running.md)         |

Both guides are step-by-step with a check after each step, so an engineer or a
coding agent can follow them end to end. [AGENTS.md](AGENTS.md) points agents
at the right one.

## In this repository

```text
docs/                      the pages above (single source for the site)
packages/protocol          @pact/protocol — Zod schemas: Agent Card, messages, errors, JWT claims
packages/client            @pact/client   — PA client: signer, fetchAgentCard, A2AClient (one file)
reference/provider         reference Provider (Next.js + PostgreSQL)
reference/personal-agent/  demo PA: JWKS server + chat UI
e2e/                       conformance tests — run against any Provider with E2E_PROVIDER=any
website/                   docs-site renderer
```

## Run it

```sh
pnpm install && pnpm gen-keys
```

then follow [Run the reference stack](docs/running.md#run-it-locally).

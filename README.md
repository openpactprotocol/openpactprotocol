# Personal Agent Consent & Trust (PACT)

Personal agents are starting to interact with business agents on their users'
behalf. Businesses need to verify which agent is calling, authenticate the
customer it represents, and confirm what that customer has authorized it to do.

PACT builds on [A2A 1.0](https://a2a-protocol.org) and OAuth to support these
interactions. Personal agents identify themselves with signed requests
(**Trust**); customers sign in directly with the business and grant permissions
(**Consent**) without sharing their login credentials with the personal agent.

| Term               | Meaning                                                                    |
| ------------------ | -------------------------------------------------------------------------- |
| **User**           | The person.                                                                |
| **Personal agent** | The agent platform acting for the User.                                    |
| **Brand**          | A business the User wants help from. Its support agent runs on a Provider. |
| **Provider**       | Builds and hosts support agents for many Brands.                           |

![PACT at a glance](docs/images/protocol-overview.svg)

## Start here

Read the documentation at [openpactprotocol.org](https://openpactprotocol.org/).

| You are                   | Read                                                                              |
| ------------------------- | --------------------------------------------------------------------------------- |
| New to PACT               | [Introduction](https://openpactprotocol.org) — what it is and how it works        |
| Building a personal agent | [Build a personal agent integration](https://openpactprotocol.org/personal-agent) |
| Building a Provider       | [Build a Provider](https://openpactprotocol.org/provider)                         |
| Checking the rules        | [Specification](https://openpactprotocol.org/spec) — the normative text           |
| Trying it on your machine | [Run the reference stack](https://openpactprotocol.org/running)                   |

[AGENTS.md](AGENTS.md) points coding agents at the right guide.

## In this repository

```text
docs/                      the pages above (single source for the site)
packages/protocol          @openpactprotocol/protocol — Zod schemas: Agent Card, messages, errors, JWT claims
packages/client            @openpactprotocol/client   — personal-agent client: signer, fetchAgentCard, A2AClient (one file)
reference/provider         reference Provider (Next.js + PostgreSQL)
reference/personal-agent/  demo personal agent: JWKS server + chat UI
e2e/                       conformance tests — run against any Provider with E2E_PROVIDER=any
```

## Run it

```sh
pnpm install && pnpm gen-keys
```

then follow [Run the reference stack](https://openpactprotocol.org/running#run-it-locally).

## License

[Apache-2.0](LICENSE).

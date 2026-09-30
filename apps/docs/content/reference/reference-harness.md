---
title: Reference harness
description: See what this repository implements and where to find reproducible local and deployment instructions.
---

This repository is a runnable PAC2 harness for exercising the boundary
between a personal-agent platform and a Customer support agent. It contains a
Next.js provider, a PostgreSQL-compatible store, a local JWKS server, a
reference TypeScript client and CLI, a local PA client UI, and live HTTP
tests.

The provider uses four tables: customers, registered agent platforms,
conversations, and messages. Customer IDs are ULIDs. Conversation UUIDs are
the A2A `contextId`, with ownership scoped to the Customer and
`{platform}:{sub}`. The PA client separately stores its own local conversation
history.

The sample provider includes a small FAQ agent to demonstrate message
continuation. Its wording and skills are harness behavior, not protocol
requirements. An external platform can integrate with a different Customer
agent as long as it follows the Agent Card, JWT, and message contract.

## Run the harness

Use the repository's [local development guide](https://github.com/decagon-external/personal-agent-protocol/blob/main/docs/local-development.md)
to install dependencies, start the local services, migrate and seed the
database, and run tests.

Deployment notes cover the provider and public JWKS server:
[deployment guide](https://github.com/decagon-external/personal-agent-protocol/blob/main/docs/deployment.md).

For the wire contract, start with [operations](/reference/operations),
[authentication](/guides/authentication), and
[messaging](/guides/messaging).

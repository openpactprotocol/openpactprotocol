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
conversations, and messages. Customer IDs are ULIDs. The demo seeds Skyline
Airways (`01M3R53Q5SZQ6FQSMSDBSSREAA`), Loom & Co.
(`01M3R53Q5WKZ7A0GY4PZ8Y39TB`), and Bloom & Stem
(`01M3R53Q5WHQ1APYDKBW3NCDG3`). Conversation UUIDs are the A2A `contextId`,
with ownership scoped to the Customer and `{platform}:{sub}`. The PA client
separately stores its own local conversation history.

The provider exposes separate flight-status, order-status, and flower-order
skills to demonstrate message continuation. Their canned responses are
harness behavior, not protocol requirements. If `OPENAI_API_KEY` is set, the
PA client uses OpenAI for routing with `OPENAI_MODEL` (default
`gpt-6-luna`). Otherwise it routes by a business-name mention, then by skill
tags read from each Agent Card, then to one thread awaiting a follow-up (the
most recently asked first, with ties in configured customer-ID order), and
finally to a random connected business. This is the personal agent's own
routing logic; PAC2 does not define routing. An external platform
can integrate with a different Customer agent as long as it follows the Agent
Card, JWT, and message contract.

Separately, the provider can use `OPENAI_API_KEY` and `OPENAI_MODEL` (default
`gpt-6-luna`) to generate business replies from conversation history and each
profile's facts. Without a key or after a failure or timeout, it uses the
deterministic canned replies.

Configure the PA client with `CUSTOMER_IDS`, a comma-separated list of
customer ULIDs. The protocol CLI continues to take one `CUSTOMER_ID` at a time.

## Run the harness

Use the repository's [local development guide](https://github.com/decagon-external/personal-agent-protocol/blob/main/docs/local-development.md)
to install dependencies, start the local services, migrate and seed the
database, and run tests.

Deployment notes cover the provider and public JWKS server:
[deployment guide](https://github.com/decagon-external/personal-agent-protocol/blob/main/docs/deployment.md).

For the wire contract, start with [operations](/reference/operations),
[authentication](/guides/authentication), and
[messaging](/guides/messaging).

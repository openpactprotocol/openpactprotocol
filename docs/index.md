---
title: Introduction
description: PACT lets a personal agent contact a Brand's support agent with a verifiable identity and only the permissions the User granted.
---

Personal agents increasingly contact Brands on someone's behalf. Today they do
it by driving a chat widget like an anonymous browser: the Brand can't tell
which agent is calling, and the agent can't act on the person's account
without their password.

**Personal Agent Consent & Trust (PACT)** fixes both:

- **Trust** — the agent signs every request, so the Brand knows which agent is
  calling.
- **Consent** — optionally, the User logs in with the Brand and approves
  specific actions. The agent never sees their password.

PACT is a new protocol built on [A2A 1.0](https://a2a-protocol.org).
Everything A2A defines works unchanged.

## Terms

| Term               | Meaning                                                                    | Example                        |
| ------------------ | -------------------------------------------------------------------------- | ------------------------------ |
| **User**           | The person.                                                                | Jane                           |
| **Personal agent** | The agent platform acting for the User.                                    | Jane's assistant app           |
| **Brand**          | A business the User wants help from. Its support agent runs on a Provider. | Loom & Co.                     |
| **Provider**       | Builds and hosts support agents for many Brands.                           | Loom's customer-support vendor |

A personal agent onboards with each Provider once, then can talk to every Brand that
Provider hosts.

## How it works

![PACT at a glance](images/protocol-overview.svg)

1. **Onboard (once per Provider).** The personal agent gives the Provider its issuer URL
   and public keys (JWKS); the Provider gives the personal agent an `audience` string.
2. **Find the agent.** The personal agent fetches the Brand's Agent Card, which says
   where to send messages. The Provider hosts it, e.g.
   `https://provider.example.com/a2a/{brandId}/.well-known/agent-card.json`. The
   personal agent finds that URL through:
   - **Well-known URL** (the standard): the Brand's own domain serves the card or
     redirects to it, e.g. `https://brand.example.com/.well-known/agent-card.json`.
   - **Link or registry**: a link from the Brand, or a public registry of Agent
     Cards, points to the card's URL on the Provider.
3. **Send.** The personal agent sends the User's message with a short-lived JWT it signed
   itself. The JWT carries a stable, anonymous id for the User.
4. **Verify.** The Provider checks the signature against the personal agent's JWKS.
5. **Reply.** The Brand's agent answers with a `contextId`; the personal agent sends it
   with later messages to continue the conversation.

**Optional: authorize.** If the Brand offers it, the User logs in with the
Brand and approves scopes. The personal agent then sends a second token and the agent can
act on the User's account. Without it, the agent knows _which personal agent_ is calling,
not _who the User is_, and asks in the conversation (order number, email) as
a chat widget would.

## Start here

- Building a personal agent → [Build a personal agent integration](personal-agent.md)
- Building a Provider → [Build a Provider](provider.md)
- The rules → [Specification](spec.md) (the only normative document)
- Try it → [Run the reference stack](running.md)

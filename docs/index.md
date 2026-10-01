---
title: Introduction
description: A protocol for personal agents to contact a business's support agent, with a verifiable identity and only the permissions the user granted.
---

Personal agents increasingly contact businesses on someone's behalf. Today
they do it by driving a chat widget like an anonymous browser. The business
can't tell which agent is calling, and the agent can't act on the person's
account without handling their password.

The **Personal Agent Consent & Trust (PACT) Protocol** fixes both:

- **Trust** — the agent signs every request, so the business knows which
  agent is calling.
- **Consent** — optionally, the person logs in with the business and approves
  specific actions. The agent never sees their password.

PACT is a profile of [A2A 1.0](https://a2a-protocol.org), the open
agent-to-agent protocol. Everything A2A defines works unchanged.

> **Example.** Jane asks her assistant to cancel an order at Loom & Co. The
> assistant finds Loom's support agent and sends a signed message. Loom knows
> it's talking to Jane's assistant. If Jane approves "cancel orders" on Loom's
> own login page, Loom's agent cancels the order and returns a signed receipt.

## Who's involved

| Term         | Meaning                                                 | Example                        |
| ------------ | ------------------------------------------------------- | ------------------------------ |
| **User**     | The person.                                             | Jane                           |
| **PA**       | The personal-agent platform acting for the User.        | Jane's assistant app           |
| **Brand**    | The business the User wants help from.                  | Loom & Co.                     |
| **Provider** | The platform that hosts support agents for many Brands. | Loom's customer-support vendor |

A PA sets up a relationship with each **Provider** once, and can then talk to
every Brand that Provider hosts.

## How it works

{% protocol-overview /%}

1. **Onboard (once per Provider).** The PA publishes its public keys and
   gives the Provider its URL. The Provider returns an `audience` value for
   the PA to put in its tokens.
2. **Ask.** The User asks the PA for help with a Brand.
3. **Find the agent.** The PA fetches the Brand's Agent Card, a public JSON
   file that says where to send messages and what the agent supports.
4. **Send.** The PA sends the message with a short-lived token signed by its
   own key. The token carries an anonymous, stable id for the User.
5. **Verify.** The Provider checks the signature against the PA's public keys.
6. **Reply.** The Brand's agent answers and returns a conversation id
   (`contextId`). The PA sends it with later messages to continue.
7. **Answer.** The PA passes the reply to the User.

**A. Authorize (optional).** If the Brand offers it, the User logs in with the
Brand and approves specific permissions. The PA then sends a second token with
its messages, and the agent can act on the User's account.

Without step A, the agent knows _which PA_ is calling, not _who the User is_.
When it needs to know, it asks in the conversation (order number, email),
exactly as it would in a chat widget.

## If you know OAuth

The identity token is not OAuth: there's no User login, consent screen or
token endpoint. The PA signs its own JWT, much like an
[RFC 7523](https://www.rfc-editor.org/rfc/rfc7523) assertion.

Step A is standard OAuth 2.0 device code
([RFC 8628](https://www.rfc-editor.org/rfc/rfc8628)), with the PA as the
client and the Provider as the authorization server. See
[Specification §5](spec.md#5-delegated-authority) for the full mapping.

## Not in PACT

Streaming, push notifications, extended Agent Cards and payments. How a Brand
logs its Users in is up to the Brand.

## Next

- [Quickstart](quickstart.md) — send your first message, locally or to a real
  Provider.
- [Specification](spec.md) — the normative text. Building a Provider? Start at
  [§7.1](spec.md#71-implementing-a-provider-identity).
- [Reference implementation](reference-implementation.md) — a working
  Provider, demo PA and conformance tests.
- [TypeScript client](typescript-client.md) — `@pact/client` and the `pact` CLI.

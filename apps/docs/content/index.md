---
title: Introduction
description: Learn the PAC2 connection between personal-agent platforms and customer support agents.
---

PAC2 (Personal Agent Customer Connector Protocol; name TBD) describes how a
personal-agent platform calls a Customer's Decagon support agent over A2A 1.0
HTTP+JSON. The platform identifies itself with a signed JWT. A conversation
uses a platform-chosen pseudonymous user subject; the protocol does not
authenticate that person as a verified Customer.

The protocol keeps two kinds of identity separate:

- A **Customer** is the business whose support agent is addressed.
- A **personal-agent platform** is the registered service signing requests.
- The platform's JWT `sub` identifies one of its users to that platform. It is
  not a Customer login or a claim that the user has been verified.

## A first integration

1. Register the platform once and publish its verification keys as a JWKS.
2. Discover the Customer's public Agent Card and select its HTTP+JSON interface.
3. Sign a platform JWT and send a `message:send` request.
4. Continue by returning the reply's `contextId`.

The [quickstart](/quickstart) walks through those calls. The
[integration guide](/guides/registration) and
[TypeScript client reference](/reference/typescript-client) cover the
production-facing details.

## V1 scope

PAC2 v1 uses A2A messages and conversation context IDs. It does not create A2A
Task resources, stream responses, deliver push notifications, or expose an
extended Agent Card. A task-list compatibility route returns an empty list;
task-specific operations report `TASK_NOT_FOUND`.

{% callout type="note" %}
This site documents the protocol and the reference harness separately. The
harness's canned business profiles and local setup are examples, not requirements for a
Customer's production support agent.
{% /callout %}

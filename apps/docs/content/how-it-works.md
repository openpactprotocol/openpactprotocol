---
title: How it works
description: Understand the platform, Customer, and provider roles and follow a complete message flow.
---

## Roles

- The **personal-agent platform** owns the signing key, registers its issuer
  and JWKS URI, and signs each runtime request.
- The **Customer** is the business tenant selected by a customer ID. The
  Customer's agent answers support questions; the platform does not need to
  create an account with that agent for every user.
- The **Decagon provider** publishes the Agent Card, verifies registered
  platform JWTs, scopes context IDs, and returns messages.
- The **end user** is represented by a pseudonymous `sub` chosen by the
  platform. V1 does not verify a real-world identity or Customer account.

## Identity model

Registration establishes one platform identity: an issuer, a name, and a
JWKS URI. Runtime requests use the platform's signing key. The provider maps
the signed `sub` to a platform user handle and scopes each conversation to
that handle and the selected Customer.

Conversation IDs are opaque UUID context IDs returned by the provider. A
context ID is not an authorization credential: each continuation is checked
against both the Customer and the authenticated platform user.
Read the [identity model](#identity-model) before integrating continuation.

## Request sequence

The following sequence omits key provisioning details. Registration and
runtime JWTs have different audiences and claims; see the
[registration guide](/guides/registration) and
[authentication guide](/guides/authentication).

```text
Personal-agent platform             Decagon provider
        |                                   |
        |-- register issuer + JWKS -------->|
        |<-- registered platform -----------|
        |                                   |
        |-- GET customer Agent Card ------->|
        |<-- HTTP+JSON interface URL --------|
        |                                   |
        |-- signed message:send ------------>|
        |<-- agent Message + contextId ------|
        |                                   |
        |-- signed message:send ------------>|
        |     same contextId                 |
        |<-- next agent Message -------------|
```

## One platform user, many conversations

The platform may choose a stable pseudonymous `sub` for one user and reuse it
across that user's Customer conversations. Each Customer/context pair remains
isolated. If the platform changes the subject for a user, the provider sees a
different conversation owner.

See [messaging](/guides/messaging) for continuation and retry behavior.

---
title: Introduction
description: PAC2 extends A2A 1.0 with two things — which PA is calling, and what the User allowed.
---

**PAC2** (Personal Agent ↔ Customer Connector) extends
[A2A 1.0](https://a2a-protocol.org) with the two things A2A leaves open:
**which PA is calling**, and **what the User allowed**. A PA reaches a Brand's support agent as an identified party
instead of driving a chat widget as an anonymous browser, and the User's
credentials never pass through the PA.

| Term         | Meaning                                                         |
| ------------ | --------------------------------------------------------------- |
| **Provider** | Builds and hosts Brands' support agents.                        |
| **Brand**    | A business whose agent runs on a Provider.                      |
| **PA**       | A personal-agent platform. Signs its requests with its own key. |
| **User**     | The person using the PA.                                        |

```text
 User ──▶ PA ──A2A over HTTPS──▶ Provider ──▶ Brand's agent
              JWT {iss, sub, aud}         verifies via JWKS · mints contextId
              delegation token (optional) checks scopes · signs receipts
```

## Two layers

| Layer                   | Who                                                  | What                                                                                                                                                                                |
| ----------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PA identity**         | every PA, every Provider                             | Signed, attributable calls. One `contextId` per User per Brand. The agent verifies the User in conversation.                                                                        |
| **Delegated authority** | Brands that define scopes and put them on their card | The Brand defines scopes for its own use cases. The User logs in with the Brand and approves some. The agent acts on their account within them. Each turn returns a signed receipt. |

A PA reads the card and does what the card supports. Turning delegation on
changes nothing in the identity layer.

## Once, per Provider

**Onboard.** Publish your JWKS; the Provider records your `issuer` and gives
you an `audience`. Whether a Provider allowlists PAs or accepts any issuer
that serves a JWKS is the Provider's policy.

## Per User

1. **Discover.** `GET /a2a/{brandId}/.well-known/agent-card.json` → interface
   URL, and whether the Brand offers delegation.
2. **Send.** `POST {interfaceUrl}/message:send` with your JWT
   `{ iss, sub, aud, iat, exp }` → reply + `contextId`.
3. **Continue.** Same call with the `contextId`.
4. **Authorize** — only if the card offers it. OAuth device code: the User
   logs in with the Brand, approves scopes, you get a delegation token and
   send it with your JWT.

## Not in PAC2

Streaming, push notifications, extended Agent Cards, payments. A2A Tasks
appear only to ask for more authorization. How a Brand logs its Users in is
the Brand's business.

## Next

- [Quickstart](quickstart.md) — first message in five minutes (PA side).
- [Specification](spec.md) — the normative text; Providers start at
  [§7.1](spec.md#71-implementing-a-provider-identity).
- [Reference implementation](reference-implementation.md) — Provider, demo PA,
  and conformance suite in this repository.
- [TypeScript client](typescript-client.md) — `@pac2/client` and the `pac2` CLI.

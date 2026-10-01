---
title: Introduction
description: PACT extends A2A 1.0 with two things — which PA is calling, and what the User allowed.
---

The **Personal Agent Consent & Trust (PACT) Protocol** extends
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

## At a glance

The User talks only to their PA. The PA talks to the Brand's agent through the
Provider, signing every call with its own key. The User's Brand login, if any,
happens with the Brand — never through the PA.

{% protocol-overview /%}

1. **Onboard** — once per Provider, not per User or Brand. Publish your JWKS;
   the Provider records your `issuer` and gives you an `audience`. Whether a
   Provider allowlists PAs or accepts any issuer that serves a JWKS is the
   Provider's policy.
2. **Ask.** The User asks the PA for help with a Brand.
3. **Discover.** `GET /a2a/{brandId}/.well-known/agent-card.json` → interface
   URL, and whether the Brand offers delegation. No token needed.
4. **Send.** `POST {interfaceUrl}/message:send` with your JWT
   `{ iss, sub, aud, iat, exp }`. `sub` is a stable, opaque id for the User.
5. **Verify.** The Provider checks the signature against your JWKS, then
   `iss`, `aud`, and expiry. Any failure is a bare `401`.
6. **Reply.** The Brand's agent answers → reply + `contextId`. Continue with
   the same call and the same `contextId`.
7. **Answer.** The PA relays the reply to the User.

**A. Authorize** — only if the card offers it. OAuth device code: the User
logs in with the Brand, approves scopes, you get a delegation token and send
it with your JWT from then on.

## Two layers

| Layer                   | Who                                                  | What                                                                                                                                                                                |
| ----------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PA identity**         | every PA, every Provider                             | Signed, attributable calls. One `contextId` per User per Brand. The agent verifies the User in conversation.                                                                        |
| **Delegated authority** | Brands that define scopes and put them on their card | The Brand defines scopes for its own use cases. The User logs in with the Brand and approves some. The agent acts on their account within them. Each turn returns a signed receipt. |

A PA reads the card and does what the card supports. Turning delegation on
changes nothing in the identity layer.

## If you know OAuth

The identity layer is not an OAuth flow: no User login, no consent screen, no
token endpoint. The PA signs its own short-lived JWT and sends it straight to
the agent's interface URL — closest to an
[RFC 7523](https://www.rfc-editor.org/rfc/rfc7523) JWT assertion. The JWT says
which PA is calling for which `sub`, not that `sub` owns a Brand account.

Delegated authority is standard OAuth 2.0 device code
([RFC 8628](https://www.rfc-editor.org/rfc/rfc8628)), with the PA as the
client:

| OAuth 2.0             | PACT                                                                        |
| --------------------- | --------------------------------------------------------------------------- |
| Client                | PA. `client_id` is its issuer URL.                                          |
| Client registration   | Onboarding: `issuer`, `jwksUri`, assigned `audience`.                       |
| Client authentication | PA JWT as `Authorization: Bearer`, on every call including the token call.  |
| Resource owner        | User — `sub` in the PA JWT; the Brand's own user id in a delegation token.  |
| Authorization server  | Provider, per Brand. The login step is the Brand's own login.               |
| Server metadata       | Agent Card, which links RFC 8414 metadata when the Brand offers delegation. |
| Scopes                | Defined by each Brand and listed on its card.                               |
| Access token          | Delegation token, sent in `X-A2A-User-Delegation` next to the PA JWT.       |
| Resource server       | The Brand's agent, behind the interface URL.                                |

## Not in PACT

Streaming, push notifications, extended Agent Cards, payments. A2A Tasks
appear only to ask for more authorization. How a Brand logs its Users in is
the Brand's business.

## Next

- [Quickstart](quickstart.md) — first message in five minutes (PA side).
- [Specification](spec.md) — the normative text; Providers start at
  [§7.1](spec.md#71-implementing-a-provider-identity).
- [Reference implementation](reference-implementation.md) — Provider, demo PA,
  and conformance suite in this repository.
- [TypeScript client](typescript-client.md) — `@pact/client` and the `pact` CLI.

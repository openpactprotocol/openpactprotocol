---
title: Build a Provider
description: Host Brands' agents behind PACT and pass the conformance suite.
---

For engineers adding PACT to a platform that hosts support agents for Brands
(a **Provider**). The rules are in the [specification](spec.md);
`reference/provider` implements all of this and `e2e/` checks it.

## 1. Onboard personal agents

Keep a record per personal agent: `issuer` (the exact `iss` string), `jwksUri`, `enabled`.
Pick one **audience** string and give it to every personal agent. Allowlisting personal agents or
accepting any `iss` that serves a JWKS is your policy
([spec §3.1](spec.md#31-onboarding)).

**Done when** you can look up a personal agent by `iss` and get its JWKS URL and enabled
state.

## 2. Serve one Agent Card per Brand

```http
GET {PROVIDER_URL}/a2a/{brandId}/.well-known/agent-card.json
```

Unauthenticated; unknown `brandId` → `404`. The card
([spec §2.1](spec.md#21-agent-card)) lists a `supportedInterfaces` entry with
`protocolBinding: "HTTP+JSON"`, `protocolVersion: "1.0"` and the `url` the
other routes hang off; declares `httpAuthSecurityScheme`
`{ scheme: "Bearer", bearerFormat: "JWT" }`; and sets `capabilities` to what
you implement (the reference Provider sets `streaming`, `pushNotifications`
and `extendedAgentCard` to `false`). Personal agents reach it from the Brand's
own `/.well-known/agent-card.json` (which serves this card or redirects here),
or from a link or registry entry.

**Done when** a Brand's card is served and an unknown id returns `404`.

## 3. Verify the personal-agent JWT on every other route

Match the route first (unknown path → `404`/`405`), then
([spec §3.2](spec.md#32-personal-agent-jwt)):

1. `alg` is `ES256` or `RS256` — reject anything else.
2. `iss` is a known, enabled personal agent.
3. Signature verifies against that personal agent's JWKS (cache; refetch on unknown `kid`).
4. `aud` is your audience; `exp` is in the future; `iat` ≤ 30 s in the future.
5. `sub` is present. The caller is `(iss, sub)`.

Any failure, with no A2A body:

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer realm="a2a"
```

**Done when** missing token, bad signature, wrong `aud`, expired, `HS256`,
and a disabled personal agent all get that `401`, and a good token passes.

## 4. Answer `message:send`

`POST {interfaceUrl}/message:send` ([spec §4](spec.md#4-messages)). Require
`role: "ROLE_USER"` and accept non-blank `text` parts. Key conversations by
`(iss, sub, brandId)`:

| Request                                       | Do                                                |
| --------------------------------------------- | ------------------------------------------------- |
| No `contextId`                                | Create a conversation, mint an opaque `contextId` |
| `contextId` owned by this `(iss, sub, brand)` | Continue it                                       |
| `contextId` owned by anyone else, or unknown  | `INVALID_PARAMS` (don't reveal whether it exists) |
| Same `messageId` again                        | Return the stored reply                           |
| Conversation closed                           | `UNSUPPORTED_OPERATION`                           |

Reply with a `ROLE_AGENT` message, or a Task for work you run as an A2A task,
carrying the `contextId`, `Content-Type: application/a2a+json`. The token says
which personal agent is calling for `sub`, not who the User is — the agent
verifies the User as it would in a chat widget.

**Done when** two messages with one `contextId` continue one conversation,
and that `contextId` from another `sub` or Brand gets `INVALID_PARAMS`.

## 5. Other routes, errors, limits

Implement the other A2A operations your card advertises, and scope tasks to
their caller as you scope contexts ([spec §4.2](spec.md#42-context)). For the
rest, return the error listed in [spec §2.2](spec.md#22-operations)
(`TASK_NOT_FOUND`, `UNSUPPORTED_OPERATION`, `PUSH_NOTIFICATION_NOT_SUPPORTED`;
`GET tasks` → the caller's tasks, often an empty list). A2A errors use the
envelope in [spec §6](spec.md#6-errors) with the reason in
`error.details[0].reason`. Plain HTTP for `401`, `404`/`405`, and `429` +
`Retry-After` when you rate-limit.

**Done when** each operation you don't advertise returns its listed error
after a valid token.

## 6. Run the conformance suite

You need two Brand IDs and a personal agent you trust; `pnpm gen-keys` makes
one (see [conformance tests](running.md#conformance-tests)). `PA_*` variables
describe that personal agent. `CUSTOMER_ID` is a Brand ID, since the code calls
Brands `customers`.

```sh
E2E_PROVIDER=any PROVIDER_URL=https://provider.example.com \
CUSTOMER_ID=<brandId> OTHER_CUSTOMER_ID=<another brandId> \
PA_ISSUER=<test personal agent's iss> PA_AUDIENCE=<your audience> PA_PRIVATE_JWK='<its private JWK>' \
pnpm e2e
```

**Done when** all 10 tests pass. That is PACT Identity conformance.

Delegated authority ([spec §5](spec.md#5-delegated-authority)) is optional
and advertised on the card. It adds per-Brand scopes and login, device-code
OAuth, delegation tokens, step-up and receipts.

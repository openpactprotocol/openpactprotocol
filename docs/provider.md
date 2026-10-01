---
title: Build a Provider
description: Host Brands' agents behind PACT - serve Agent Cards, verify PA JWTs, scope conversations, pass the conformance suite.
---

For engineers adding PACT to a platform that hosts support agents for Brands
(a **Provider**). Seven steps, each with a check. The normative rules are in
the [specification](spec.md); `reference/provider` implements all of this,
and `e2e/` checks it.

## 1. Onboard PAs

Keep a record per PA: `issuer` (exact string the PA puts in `iss`), `jwksUri`
(HTTPS), `enabled`. Assign one **audience** string and give it to every PA
(one value per Provider; not derived from a card URL). Whether you accept
only PAs you've allowlisted or any `iss` that serves a JWKS is your policy
([spec §3.1](spec.md#31-onboarding)); how PAs send you `iss` + `jwksUri` is up
to you.

**Done when** you can look up a PA by `iss` and know its JWKS URL and whether
it's enabled.

## 2. Serve one Agent Card per Brand

```http
GET {PROVIDER_URL}/a2a/{brandId}/.well-known/agent-card.json
```

Unauthenticated. Unknown `brandId` → `404`, no body. The card MUST
([spec §2.1](spec.md#21-agent-card)):

- list a `supportedInterfaces` entry with `protocolBinding: "HTTP+JSON"`,
  `protocolVersion: "1.0"`, and the `url` all other routes hang off;
- declare the PA JWT as `httpAuthSecurityScheme` `{ scheme: "Bearer", bearerFormat: "JWT" }`,
  alone in one `securityRequirements` entry;
- set `capabilities.streaming`, `pushNotifications`, `extendedAgentCard` to `false`.

Brands give PAs this URL; you don't need a discovery service.

**Done when** `curl` of a Brand's card returns it, and an unknown id returns
`404`.

## 3. Verify the PA JWT on every other route

Match the route first (unknown paths → `404`/`405`, no body), then
authenticate, then look up the Brand ([spec §3.2](spec.md#32-pa-jwt)):

1. `Authorization: Bearer <jwt>`; header `alg` is `ES256` or `RS256` — reject
   anything else, including `HS256`.
2. `iss` is a known, enabled PA.
3. Signature verifies against a key from that PA's `jwksUri` (cache it;
   refetch on an unknown `kid`).
4. `aud` equals the audience you assigned. `exp` is in the future and `iat`
   not more than 30 s in the future (30 s skew).
5. `sub` is present. The caller is the pair `(iss, sub)`.

Any failure:

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer realm="a2a"
```

with no A2A body. A valid token for an unknown Brand is `404`.

**Done when** a missing token, bad signature, wrong `aud`, expired `exp`,
`HS256`, and a disabled PA all get `401` with that header, and a good token
passes.

## 4. Answer `message:send`

`POST {interfaceUrl}/message:send`, body an A2A `SendMessageRequest`
([spec §4](spec.md#4-messages)). Validate: `role` is `ROLE_USER`, at least
one non-blank `text` part (other part kinds → `CONTENT_TYPE_NOT_SUPPORTED`),
no `taskId` (→ `TASK_NOT_FOUND`).

Conversations are keyed by `(iss, sub, brandId)`:

| Request                                       | Do                                                                 |
| --------------------------------------------- | ------------------------------------------------------------------ |
| No `contextId`                                | Create a conversation, mint an opaque `contextId`                  |
| `contextId` owned by this `(iss, sub, brand)` | Continue it                                                        |
| `contextId` owned by anyone else, or unknown  | `INVALID_PARAMS` (don't reveal whether it exists)                  |
| Same `messageId` again in a context           | Return the stored reply; `INVALID_PARAMS` if there is no reply yet |
| Conversation closed or expired                | `UNSUPPORTED_OPERATION`; the PA starts a new one                   |

Run the Brand's agent and reply synchronously:

```json
{
  "message": {
    "messageId": "r-001",
    "contextId": "…",
    "role": "ROLE_AGENT",
    "parts": [{ "text": "…" }]
  }
}
```

with `Content-Type: application/a2a+json`. The token proves which PA is
calling for `sub`, not who the User is — the agent verifies the User the way
it does in a chat widget (order number, email).

**Done when** two messages with the same `contextId` continue one
conversation, and the same `contextId` from another `sub` or Brand gets
`INVALID_PARAMS`.

## 5. Answer the other A2A routes

Generic A2A clients will call these; fail cleanly
([spec §2.2](spec.md#22-operations)):

| Method          | Path                                            | Result                                             |
| --------------- | ----------------------------------------------- | -------------------------------------------------- |
| `GET`           | `tasks`                                         | `200` empty `ListTasksResponse` (`pageSize` 1–100) |
| `GET`           | `tasks/{id}`                                    | `TASK_NOT_FOUND`                                   |
| `POST`          | `tasks/{id}:cancel`                             | `TASK_NOT_FOUND`                                   |
| `POST`          | `tasks/{id}:subscribe`, `message:stream`        | `UNSUPPORTED_OPERATION`                            |
| `GET`           | `extendedAgentCard`                             | `UNSUPPORTED_OPERATION`                            |
| `GET`, `POST`   | `tasks/{id}/pushNotificationConfigs`            | `PUSH_NOTIFICATION_NOT_SUPPORTED`                  |
| `GET`, `DELETE` | `tasks/{id}/pushNotificationConfigs/{configId}` | `PUSH_NOTIFICATION_NOT_SUPPORTED`                  |

**Done when** each returns the listed A2A error after a valid token.

## 6. Errors and limits

A2A errors use the A2A / AIP-193 envelope; `code` repeats the HTTP status and
the reason is `error.details[0].reason` ([spec §6](spec.md#6-errors)):

```json
{
  "error": {
    "code": 400,
    "status": "INVALID_ARGUMENT",
    "message": "Unknown contextId",
    "details": [
      {
        "@type": "type.googleapis.com/google.rpc.ErrorInfo",
        "reason": "INVALID_PARAMS",
        "domain": "a2a-protocol.org"
      }
    ]
  }
}
```

Plain HTTP, no envelope, for `401` (step 3), `404`/`405` on unmatched routes
and unknown Brands, and `429` + `Retry-After` when you rate-limit a PA or an
`(iss, sub)`.

## 7. Run the conformance suite

`e2e/` drives your Provider over HTTP and checks everything above. It needs
two Brand IDs and a PA key your Provider trusts (its `iss`, JWKS, and private
JWK — `pnpm gen-keys` makes one and serves it from
`reference/personal-agent/server`).

```sh
E2E_PROVIDER=any \
PROVIDER_URL=https://provider.example.com \
CUSTOMER_ID=<brandId> OTHER_CUSTOMER_ID=<another brandId> \
PA_ISSUER=<your test PA's iss> PA_AUDIENCE=<audience you assigned> \
PA_PRIVATE_JWK='<its private JWK>' \
pnpm e2e
```

`E2E_PROVIDER=any` skips only the reference Provider's seeded card text and
canned replies. Details: [Conformance tests](running.md#conformance-tests).
(The code calls Brands `customers`, hence `CUSTOMER_ID`.)

**Done when** all 10 tests pass. That is PACT Identity conformance.

## Later: delegated authority

To let Users approve scopes and have agents act on their accounts, add
[spec §5](spec.md#5-delegated-authority): scopes and a login per Brand, an
OAuth device-code server under `{interfaceUrl}/oauth/`, delegation-token
checks, step-up, and receipts. Optional; advertised on the card; no public
implementation yet.

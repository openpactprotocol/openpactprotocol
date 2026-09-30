---
title: Authentication
description: Sign each A2A request with a platform JWT and a pseudonymous user subject.
---

Send runtime assertions in the standard bearer header:

```http
Authorization: Bearer <platform-jwt>
```

The reference provider accepts JWTs signed with **RS256** or **ES256** by a
registered, enabled platform. It verifies against that platform's registered
JWKS URI.

## Required claims

Runtime tokens must contain `iss`, `sub`, `aud`, `iat`, and `exp`.

| Claim | Meaning                                           |
| ----- | ------------------------------------------------- |
| `iss` | Exact issuer string registered for the platform   |
| `sub` | Stable, pseudonymous platform user handle         |
| `aud` | Audience assigned by the provider at registration |
| `iat` | Issued-at timestamp in seconds                    |
| `exp` | Expiration timestamp in seconds                   |

The audience is provider-wide: one token works for every Customer interface
on the provider. Do not set it to the customer-specific Agent Card URL. The
provider assigns it when the platform registers (the reference provider uses
its `A2A_AUDIENCE` unless an override is registered); configure it as
`PA_AUDIENCE`.

The verifier requires expiration and applies a 30-second clock tolerance. It
also rejects an `iat` more than 30 seconds in the future. Runtime tokens do
not require a `jti`, do not have replay tracking, and have no configured
maximum lifetime.

The reference `A2AClient` sends `A2A-Version: 1.0` and
`Content-Type: application/json`. The provider currently does not enforce
either request header.

## Choosing `sub`

Choose a stable, opaque handle that lets your platform distinguish users
without disclosing their identity. The same `sub` should be used when that
user continues a context. Do not put email addresses, names, account numbers,
or other personal information in the subject.

V1 authenticates the platform, not the end user. A `sub` is an assertion from
the platform and is not proof that the person controls a Customer account.
Per-user identity verification is a later extension.

{% callout type="warning" %}
A signed JWT is a bearer credential. Anyone who obtains it can present its
platform identity and subject until it expires. Protect signing keys, keep
tokens short-lived, and never log or expose them to an untrusted client.
{% /callout %}

## Authentication failures

Matched private A2A operations return an empty `401 Unauthorized` with
`WWW-Authenticate: Bearer realm="a2a"` if the bearer token is missing or
invalid, the platform is unknown or disabled, a claim or audience is invalid,
the token has expired, or signature verification fails. Unknown paths are
matched before authentication and return an empty `404` instead.

See the [error reference](/reference/errors) for the distinction between
authentication failures and A2A protocol errors.

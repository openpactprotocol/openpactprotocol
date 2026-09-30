---
title: Platform registration
description: Register a platform identity and publish the JWKS used to verify its signed requests.
---

Registration establishes a platform identity once, not once per end user.
The platform provides a stable issuer URL, a platform name, and a JWKS URL on
the issuer's origin. The reference onboarding flow accepts ES256 assertions;
runtime A2A requests may use RS256 or ES256.

Keep the platform's private signing key on trusted infrastructure. Key
rotation is performed by publishing the new public key in the registered JWKS
document. The registered issuer and JWKS URI do not need to change for a
rotation.

{% callout type="warning" %}
A disabled platform cannot make runtime A2A requests: the reference provider
returns an empty 401 with `WWW-Authenticate`. Re-registration does not
re-enable a disabled platform.
{% /callout %}

## Reference-provider onboarding endpoint

The following contract describes this repository's self-serve endpoint. A
deployed provider may onboard platforms out of band.

`POST {PROVIDER_URL}/api/platforms` requires `Content-Type: application/json`
and this body:

```json
{
  "name": "instinct",
  "jwksUri": "https://agent.example.com/.well-known/jwks.json"
}
```

The name must match `^[a-z0-9][a-z0-9-]{1,62}$`. The endpoint validates a
self-signed assertion from `Authorization: Bearer <token>` with:

| Claim or header     | Requirement                               |
| ------------------- | ----------------------------------------- |
| `alg`               | `ES256`                                   |
| `iss`               | Absolute issuer URL; no query or fragment |
| `sub`               | Exactly equal to `iss`                    |
| `aud`               | `{PROVIDER_URL}/api/platforms`            |
| `iat`, `exp`, `jti` | Required; lifetime at most 300 seconds    |

The issuer and JWKS URI must use HTTPS, or HTTP on `localhost` or
`127.0.0.1` for local development. The JWKS URI must have the same origin as
the issuer. The JWKS is fetched from the URI in the request body to verify
the assertion.

The provider enables a new registration automatically. It stores the issuer
as signed and preserves its trailing slash, if any.

| Result                           | Meaning                                                 |
| -------------------------------- | ------------------------------------------------------- |
| `201` with `{ "platform": ... }` | Newly registered and enabled                            |
| `200` with `{ "platform": ... }` | Same issuer, name, and JWKS URI already registered      |
| `409` with `{ "error": ... }`    | Name or issuer is already used with conflicting details |
| `400` with `{ "error": ... }`    | Invalid body or URL                                     |
| Empty `401`                      | Missing/invalid assertion or signature                  |

An identical retry is idempotent and returns the platform's current enabled
state; it does not change that state. See
[authentication](/guides/authentication) for runtime JWTs and audiences.

The assertion must contain `jti`, but the reference provider does not keep a
registration replay list. Re-registration is resolved by the issuer, name,
and JWKS URI already stored for the platform.

## Register with the reference client

The repository's `registerPlatform` helper signs the registration assertion,
defaults `jwksUri` to
`{issuer}/.well-known/jwks.json`, and reports whether it created a row:

```ts
const result = await registerPlatform({
  providerUrl: "https://provider.example.com",
  name: "instinct",
  signer,
});
console.log(result.created ? "created" : "already registered");
```

The equivalent CLI command is `pap register --name instinct`.

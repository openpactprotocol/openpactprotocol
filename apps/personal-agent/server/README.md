# PA JWKS server

This static server publishes the personal-agent platform's public JWKS at
`/.well-known/jwks.json`. The provider fetches the registered platform keys
from this URL to verify signed runtime messages and platform registration
assertions.

Only public keys belong here. The matching private JWK is held by the PA
client or another trusted signer. See the [registration
guide](../../../apps/docs/content/guides/registration.md) for key and issuer
requirements, and the [local development
guide](../../../docs/local-development.md) for generating and serving local
keys.

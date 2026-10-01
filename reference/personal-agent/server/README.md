# Demo PA JWKS server

Static site publishing the demo PA's public keys at `/.well-known/jwks.json`.
The Provider fetches them to verify the PA's JWTs. Public keys only;
`pnpm gen-keys` at the repository root writes them. See
[Run the reference stack](../../../docs/running.md#run-it-locally).

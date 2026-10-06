# Demo personal agent JWKS server

Static site publishing the demo personal agent's public keys at `/.well-known/jwks.json`.
The Provider fetches them to verify the personal agent's JWTs. Public keys only;
`pnpm gen-keys` at the repository root writes them. See
[Run the reference stack](https://openpactprotocol.org/running#run-it-locally).

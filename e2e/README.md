# End-to-end tests

The E2E suite exercises the running local JWKS server and provider through
their HTTP boundaries. It covers customer-ID card discovery, Message-only
turns, context ownership and continuation, task compatibility routes, A2A
errors, and runtime JWT authentication.

Configure `PROVIDER_URL`, `CUSTOMER_ID` (Skyline Airways),
`OTHER_CUSTOMER_ID` (Loom & Co.), `PA_ISSUER`, `PA_AUDIENCE`, and
`PA_PRIVATE_JWK`. The suite also reads values from the PA client's ignored
`.env.local`. Start and seed the local stack as described in the [local
development guide](../docs/local-development.md), then run:

```sh
pnpm e2e
```

To run the suite against another PAC2 provider, set `E2E_PROVIDER=any`: it
keeps every protocol assertion but skips the reference provider's seeded card
content and canned replies. `E2E_TEST_TIMEOUT_MS` (default 60000) bounds each
test.

See the [operations reference](../apps/docs/content/reference/operations.md)
and [errors reference](../apps/docs/content/reference/errors.md) for the route
and error contract.

# Conformance suite

Live HTTP tests for the [specification](../docs/spec.md)'s Identity profile:
Agent Card discovery, `contextId` continuation, duplicate `messageId`,
cross-User / cross-Brand isolation, task routes, error envelopes, content
types, unmatched routes, authentication negatives.

```sh
PROVIDER_URL=… CUSTOMER_ID=… OTHER_CUSTOMER_ID=… PA_ISSUER=… PA_AUDIENCE=… pnpm e2e
```

`CUSTOMER_ID` is a Brand ID. `PA_*` variables describe the personal agent
(PA) the tests sign as. `PA_PRIVATE_JWK` comes from the environment or the
demo personal agent's `.env.local`. Against a Provider other than the reference one,
add `E2E_PROVIDER=any` (skips only the reference Provider's seeded card text
and canned replies). `E2E_TEST_TIMEOUT_MS` (default 60000) bounds each test.
Full setup:
[Run the reference stack → Conformance tests](../docs/running.md#conformance-tests).

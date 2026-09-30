# Reference client and CLI

`@pac2/client` provides platform JWT signing, Agent Card discovery, message
sending, and platform registration. `A2AClient.sendMessage(text, { contextId
})` returns a `Message`; its default audience is `{provider origin}/a2a`, or
pass `audience` for a platform with an explicit registration override.

The `pac2` CLI supports:

```sh
pnpm --filter @pac2/client pac2 card
pnpm --filter @pac2/client pac2 send "What are your hours?"
pnpm --filter @pac2/client pac2 send "hours" --context <context-id>
pnpm --filter @pac2/client pac2 chat
pnpm --filter @pac2/client pac2 register
```

The A2A commands use `PROVIDER_URL`, `CUSTOMER_ID`, `PA_ISSUER`, and
`PA_PRIVATE_JWK`; registration does not require a customer ID. Set
`PA_AUDIENCE` only to override the shared default. See the [authentication
guide](../../apps/docs/content/guides/authentication.md) and [messaging
guide](../../apps/docs/content/guides/messaging.md) for request and JWT rules.

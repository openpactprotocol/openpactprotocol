# Reference client and CLI

`@pac2/client` provides platform JWT signing, Agent Card discovery, message
sending, and platform registration. `A2AClient.sendMessage(text, { contextId
})` returns a `Message`; `audience` is the value the provider assigned at
registration.

The `pac2` CLI supports:

```sh
pnpm --filter @pac2/client pac2 card
pnpm --filter @pac2/client pac2 send "What are your hours?"
pnpm --filter @pac2/client pac2 send "hours" --context <context-id>
pnpm --filter @pac2/client pac2 chat
pnpm --filter @pac2/client pac2 register
```

The A2A commands use `PROVIDER_URL`, `CUSTOMER_ID`, `PA_ISSUER`,
`PA_PRIVATE_JWK`, and `PA_AUDIENCE`; registration does not require a customer
ID or audience. See the [authentication
guide](../../apps/docs/content/guides/authentication.md) and [messaging
guide](../../apps/docs/content/guides/messaging.md) for request and JWT rules.

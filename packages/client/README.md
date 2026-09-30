# Reference client and CLI

`@pap/client` provides platform JWT signing, Agent Card discovery, message
sending, and platform registration. `A2AClient.sendMessage(text, { contextId
})` returns a `Message`; its default audience is `{provider origin}/a2a`, or
pass `audience` for a platform with an explicit registration override.

The `pap` CLI supports:

```sh
pnpm --filter @pap/client pap card
pnpm --filter @pap/client pap send "What are your hours?"
pnpm --filter @pap/client pap send "hours" --context <context-id>
pnpm --filter @pap/client pap chat
pnpm --filter @pap/client pap register
```

The A2A commands use `PROVIDER_URL`, `CUSTOMER_ID`, `PA_ISSUER`, and
`PA_PRIVATE_JWK`; registration does not require a customer ID. Set
`PA_AUDIENCE` only to override the shared default. See the [protocol
guide](../../docs/protocol.md) for the request and JWT rules.

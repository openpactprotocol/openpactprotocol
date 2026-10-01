# @pact/client

PA-side client: `createPlatformSigner`, `discoverAgent`, `A2AClient`,
`registerPlatform`, typed errors, and the `pact` CLI.

```ts
const signer = createPlatformSigner({ issuer, privateJwk });
const { url } = await discoverAgent(providerUrl, brandId);
const client = new A2AClient({ url, signer, userId, audience });
const reply = await client.sendMessage("Where is my order?");
```

API and CLI: [TypeScript client](../../docs/typescript-client.md).

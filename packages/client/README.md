# @pact/client

PA-side client: `createPlatformSigner`, `fetchAgentCard`, `interfaceUrl`,
`A2AClient`, typed errors, and the `pact` CLI.

```ts
const signer = createPlatformSigner({ issuer, privateJwk });
const card = await fetchAgentCard(cardUrl);
const client = new A2AClient({
  url: interfaceUrl(card),
  getToken: () => signer.sign({ sub: userId, aud: audience }),
});
const reply = await client.sendMessage("Where is my order?");
```

API and CLI: [TypeScript client](../../docs/typescript-client.md).

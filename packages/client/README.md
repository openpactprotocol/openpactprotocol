# @openpactprotocol/client

Personal-agent-side client: `createPlatformSigner`, `fetchAgentCard`, `interfaceUrl`,
`A2AClient`, typed errors.

```ts
const signer = createPlatformSigner({ issuer, privateJwk });
const card = await fetchAgentCard(cardUrl);
const client = new A2AClient({
  url: interfaceUrl(card),
  getToken: () => signer.sign({ sub: userId, aud: audience }),
});
const reply = await client.sendMessage("Where is my order?");
```

How to use it: [Build a personal agent integration](../../docs/personal-agent.md).

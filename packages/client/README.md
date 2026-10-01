# @pact/client

PA-side client: `fetchAgentCard`, `interfaceUrl`, `A2AClient`, typed errors,
and the `pact` CLI. Bring your own JWT.

```ts
const card = await fetchAgentCard(cardUrl);
const client = new A2AClient({ url: interfaceUrl(card), getToken: () => signPaJwt(userId) });
const reply = await client.sendMessage("Where is my order?");
```

API and CLI: [TypeScript client](../../docs/typescript-client.md).

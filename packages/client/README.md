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

## Delegated authority (optional)

`@openpactprotocol/client/delegation` adds the personal-agent side of
[spec §5](../../docs/spec.md#5-delegated-authority): `delegationScheme(card)`,
`DeviceCodeClient` (device code, polling, refresh), `DelegatedA2AClient`
(sends `X-A2A-User-Delegation`, returns replies with receipts or step-up tasks), and
`verifyReceipt`. Identity-only integrations don't need it.

```ts
const scheme = delegationScheme(card); // undefined if the Brand doesn't offer delegation
const oauth = new DeviceCodeClient({ scheme, clientId: issuer, getToken });
const authorization = await oauth.start(["orders:read"]);
// show authorization.verificationUriComplete to the User, then:
const token = await oauth.waitForToken(authorization);
const client = new DelegatedA2AClient({
  url,
  getToken,
  getDelegationToken: () => token.accessToken,
});
const result = await client.send("Where is my order?");
```

---
title: TypeScript client
description: Sign the PA JWT, fetch a Brand's Agent Card, and send messages from TypeScript.
---

`@pact/client` (`packages/client`) is the PA side of the
[specification](spec.md) in one short file: sign the PA JWT, fetch a card,
pick the interface, send `message:send`, parse errors.

It isn't published to npm yet. Import it inside this repository, or copy
`packages/client/src/index.ts` (depends on `jose` and `@pact/protocol`).

## Use

```ts
import { A2AClient, createPlatformSigner, fetchAgentCard, interfaceUrl } from "@pact/client";

const signer = createPlatformSigner({ issuer: PA_ISSUER, privateJwk });
const card = await fetchAgentCard(cardUrl); // the Brand gives you this URL
const client = new A2AClient({
  url: interfaceUrl(card),
  getToken: () => signer.sign({ sub: "user-7f3a", aud: PA_AUDIENCE }),
});

const first = await client.sendMessage("I need help");
const next = await client.sendMessage("Here is more detail", { contextId: first.contextId });
```

- `createPlatformSigner({ issuer, privateJwk })` takes an ES256 private JWK
  with a `kid`. `sign({ sub, aud, ttlSeconds? })` returns a JWT with `iss`,
  `sub`, `aud`, `iat`, `exp` (default 120 s, max 300) and `jti`
  ([spec §3.2](spec.md#32-pa-jwt)).
- `fetchAgentCard(url)` validates the card against the schema.
- `interfaceUrl(card)` returns the `HTTP+JSON` / `1.0` interface URL, or
  throws.
- `getToken()` is called once per request; return any PA JWT for this User.
- `sendMessage(text, { contextId? })` sends a `ROLE_USER` text message with a
  fresh `messageId`, sets `A2A-Version: 1.0`, and returns the agent `Message`.

## Errors

| Class          | Thrown when                                      | Fields                                      |
| -------------- | ------------------------------------------------ | ------------------------------------------- |
| `A2AError`     | The Provider returned an A2A error envelope      | `httpStatus`, `status`, `reason`, `details` |
| `A2AHttpError` | Non-2xx without an envelope, e.g. `401` or `404` | `status`, `body`                            |

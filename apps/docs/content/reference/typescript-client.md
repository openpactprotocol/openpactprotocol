---
title: TypeScript client and CLI
description: Use the repository's signer, registration helper, A2A client, typed errors, and pap command-line interface.
---

The reference package `@pap/client` exports the platform signer, registration
helper, Agent Card discovery, and HTTP+JSON client.

## Signer and registration

`createPlatformSigner` accepts an issuer and private JWK. Its `sign` method
takes a `sub`, an `aud`, and an optional `ttlSeconds` from 1 to 300. The
reference signer emits ES256 JWTs with a `jti`.

```ts
import { createPlatformSigner, registerPlatform } from "@pap/client";

const signer = createPlatformSigner({
  issuer: "https://agent.example.com",
  privateJwk,
});
const registration = await registerPlatform({
  providerUrl: "https://provider.example.com",
  name: "instinct",
  signer,
});
```

`registerPlatform` defaults the JWKS URI to
`{issuer}/.well-known/jwks.json`. It returns
`{ created: boolean, platform: RegisteredPlatform }`; HTTP `201` means
`created: true`, while an idempotent `200` means `false`.

## Discover and send

`discoverAgent(providerUrl, customerId)` returns the validated Agent Card and
the selected HTTP+JSON interface URL. `A2AClient` signs each send with the
configured user subject:

```ts
import { A2AClient, discoverAgent } from "@pap/client";

const discovered = await discoverAgent(providerUrl, customerId);
const client = new A2AClient({
  url: discovered.url,
  signer,
  userId: "pseudonymous-user-7f3a",
  // audience: "https://provider.example.com/a2a", // optional override
});

const firstReply = await client.sendMessage("I need help");
const followUp = await client.sendMessage("Here is more detail", {
  contextId: firstReply.contextId,
});
```

The client defaults `audience` to the provider origin plus `/a2a`. Its
`sendMessage(text, { contextId? })` returns the agent `Message` directly.
The reference client sets `A2A-Version: 1.0` and
`Content-Type: application/json`.

## Errors

- `A2AError` exposes `httpStatus`, A2A `status`, `reason`, `message`, and
  `details` for an AIP-193 response.
- `A2AHttpError` exposes `status` and `body` when the response is not an A2A
  error envelope, including bare `401` and `404` responses.
- `PlatformRegistrationError` exposes the HTTP `status` and provider message.

## CLI

The package publishes the `pap` command:

```sh
pap register [--name <name>] [--jwks-uri <url>]
pap card
pap send <text> [--context <id>]
pap chat
```

`register` requires `PROVIDER_URL`, `PA_ISSUER`, and `PA_PRIVATE_JWK`, but not
`CUSTOMER_ID`. The name defaults to `PA_PLATFORM_NAME`, then `demo-pa`.
`card`, `send`, and `chat` also need `CUSTOMER_ID`; send and chat require the
issuer and private JWK. Set `PA_AUDIENCE` to override the runtime audience.
`PA_USER_ID` optionally sets the CLI's pseudonymous user subject and defaults
to `demo-user`.

See the [API reference package README](https://github.com/decagon-external/personal-agent-protocol/blob/main/packages/client/README.md)
for package-specific development notes.

# Protocol package

`@pac2/protocol` exports Zod schemas and types for the A2A HTTP+JSON messages,
Agent Card, error responses, and platform JWT claims. Its A2A error mapping is
shared by the provider and reference client.

Platform registration schemas are a separate provider onboarding contract;
they are not A2A message types. Task resources are not modeled because this
harness returns a Message from `message:send` and its task-list route is empty.

See the [operations reference](../../apps/docs/content/reference/operations.md),
[registration guide](../../apps/docs/content/guides/registration.md), and
[errors reference](../../apps/docs/content/reference/errors.md) for routes,
authentication, registration, and error behavior.

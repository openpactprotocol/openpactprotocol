# @openpactprotocol/protocol

Zod schemas and types for the wire format in the
[specification](../../docs/spec.md): Agent Card, `Message` /
`SendMessageRequest` / `SendMessageResponse`, `ListTasksResponse`, the A2A
error envelope and reason→status mapping (`A2A_ERRORS`), and personal-agent JWT claims.
The registration schemas belong to the reference Provider's registration API,
not to the protocol.

`@openpactprotocol/protocol/delegation` adds the optional Delegated profile
([spec §5](../../docs/spec.md#5-delegated-authority)): the device-code security
scheme, RFC 8414 / RFC 8628 responses, delegation-token claims, `Task` and the
`{ message } | { task }` reply, step-up metadata, and receipts. Nothing in the main
entry point changes.

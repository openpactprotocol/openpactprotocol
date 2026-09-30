# PAC2 protocol

PAC2 is a harness for a personal-agent platform to call a customer's support
agent over A2A 1.0 HTTP+JSON. Each request is signed by the platform; customer
conversations are anonymous and owned by the customer ID and platform user
subject.

## Customer and interface identifiers

Customers have ULID text IDs. The public Agent Card is at
`GET {PROVIDER_URL}/a2a/{customerId}/.well-known/agent-card.json`, and its
`supportedInterfaces` URL is `{PROVIDER_URL}/a2a/{customerId}`.

## Routes

Paths below are relative to the customer interface URL.

| Method          | Path                                            | Behavior                                                                                                          |
| --------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `GET`           | `.well-known/agent-card.json`                   | Public card; unknown customer ID returns an empty 404.                                                            |
| `POST`          | `message:send`                                  | Send a `SendMessageRequest`; returns HTTP 200 `{ "message": Message }`.                                           |
| `POST`          | `message:stream`                                | `UNSUPPORTED_OPERATION`.                                                                                          |
| `GET`           | `tasks`                                         | Returns an empty task list. Only `pageSize` is validated; it defaults to 50 and must be an integer from 1 to 100. |
| `GET`           | `tasks/{id}`                                    | `TASK_NOT_FOUND`.                                                                                                 |
| `POST`          | `tasks/{id}:cancel`                             | `TASK_NOT_FOUND`.                                                                                                 |
| `GET`, `POST`   | `tasks/{id}:subscribe`                          | `UNSUPPORTED_OPERATION`.                                                                                          |
| `GET`, `POST`   | `tasks/{id}/pushNotificationConfigs`            | `PUSH_NOTIFICATION_NOT_SUPPORTED`.                                                                                |
| `GET`, `DELETE` | `tasks/{id}/pushNotificationConfigs/{configId}` | `PUSH_NOTIFICATION_NOT_SUPPORTED`.                                                                                |
| `GET`           | `extendedAgentCard`                             | `UNSUPPORTED_OPERATION`.                                                                                          |

All unmatched method/path combinations return an empty 404 before authentication.
Matched operations authenticate before looking up the customer or parsing the
request body. Authentication failures return an empty 401 with
`WWW-Authenticate: Bearer realm="a2a"`.

### Sending messages

The request body contains `message`, with optional `configuration` and
`metadata`. The provider ignores `configuration`. Messages must have
`ROLE_USER`, at least one nonblank text part, and no `taskId`; non-text parts
are unsupported. Invalid JSON or schema, an invalid role, or blank text returns
`INVALID_PARAMS`; a supplied `taskId` returns `TASK_NOT_FOUND`.

With no `contextId`, the provider creates a conversation whose UUID ID becomes
the returned context. With a context, the conversation must belong to both the
customer ID and authenticated `{platform}:{sub}` user. Missing or foreign
contexts return `INVALID_PARAMS` with `Unknown contextId`.

Repeating a user `messageId` in the same context returns the immediately
following stored agent message without another agent turn. If no reply is
stored, the provider returns `INVALID_PARAMS`. A retry without a `contextId`
starts a new conversation.

The dummy agent answers FAQ topics and keeps topic-clarification flow in
conversation metadata. A follow-up such as `hours` can therefore answer a
topic prompt in the same context.

## Authentication and errors

The runtime accepts RS256 and ES256 platform JWTs with `iss`, `sub`, `aud`,
`iat`, and `exp`. It does not require or track `jti`, and does not impose a
maximum token lifetime. It retains a 30-second clock tolerance and rejects an
`iat` more than 30 seconds in the future.

The expected audience is the registered platform's `audience` value, if set;
otherwise it is `{PROVIDER_URL}/a2a`. The same token can therefore call any
customer. The customer-specific Agent Card URL is not the default audience.
Request `Content-Type` and `A2A-Version` are not enforced. The reference client
sends `application/json` and `A2A-Version: 1.0`; provider JSON responses use
`application/a2a+json`.

A2A errors use the AIP-193 body shape:

```json
{
  "error": {
    "code": 400,
    "status": "INVALID_ARGUMENT",
    "message": "Invalid request body",
    "details": [
      {
        "@type": "type.googleapis.com/google.rpc.ErrorInfo",
        "reason": "INVALID_PARAMS",
        "domain": "a2a-protocol.org"
      }
    ]
  }
}
```

| Reason                            | HTTP | Status                |
| --------------------------------- | ---: | --------------------- |
| `INVALID_PARAMS`                  |  400 | `INVALID_ARGUMENT`    |
| `CONTENT_TYPE_NOT_SUPPORTED`      |  400 | `INVALID_ARGUMENT`    |
| `UNSUPPORTED_OPERATION`           |  400 | `FAILED_PRECONDITION` |
| `PUSH_NOTIFICATION_NOT_SUPPORTED` |  400 | `FAILED_PRECONDITION` |
| `TASK_NOT_FOUND`                  |  404 | `NOT_FOUND`           |
| `INTERNAL`                        |  500 | `INTERNAL`            |

## Platform registration

Register a platform once at `POST {PROVIDER_URL}/api/platforms` with a JSON
body containing `name` and `jwksUri`. The provider verifies an ES256
self-signed assertion using the public JWKS at `jwksUri`. Registration requires
`iss === sub`, an audience of `{PROVIDER_URL}/api/platforms`, `iat`, `exp`,
`jti`, a lifetime no longer than 300 seconds, and the same 30-second
future-`iat` check. The issuer and JWKS URI must be HTTPS (or local HTTP on
`localhost`/`127.0.0.1`); the JWKS must share the issuer's origin. A trailing
slash on `iss` is preserved as signed. Registration has no replay tracking.

A new platform is enabled automatically and returns 201. Repeating identical
registration returns 200 without re-enabling a disabled platform. Conflicting
issuer or name details return 409. Key rotation only requires updating the
JWKS document at the registered URI.

## Example

Sign a runtime token for the shared audience `${PROVIDER_URL}/a2a`, then send:

```sh
curl -X POST "$PROVIDER_URL/a2a/$CUSTOMER_ID/message:send" \
  -H "Authorization: Bearer $TOKEN" \
  -H "A2A-Version: 1.0" \
  -H "Content-Type: application/json" \
  -d '{"message":{"messageId":"message-1","role":"ROLE_USER","parts":[{"text":"What are your hours?"}]}}'
```

For onboarding and development commands, see the [local development
guide](local-development.md). The provider and clients are described in their
component READMEs.

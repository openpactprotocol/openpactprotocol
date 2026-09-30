---
title: Errors and troubleshooting
description: Interpret AIP-193 A2A errors and distinguish them from bare HTTP authentication and routing responses.
---

Protocol errors use the AIP-193 error envelope. `code` repeats the HTTP status
and `status` is the corresponding status string:

```json
{
  "error": {
    "code": 400,
    "status": "INVALID_ARGUMENT",
    "message": "Unknown contextId",
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

## Error mapping

| Reason                            | HTTP | Status                | Typical trigger                                                                                                         |
| --------------------------------- | ---: | --------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `INVALID_PARAMS`                  |  400 | `INVALID_ARGUMENT`    | Invalid JSON/schema, wrong role, blank text, invalid page size, duplicate without reply, or unknown/foreign `contextId` |
| `CONTENT_TYPE_NOT_SUPPORTED`      |  400 | `INVALID_ARGUMENT`    | A message contains a non-text part                                                                                      |
| `UNSUPPORTED_OPERATION`           |  400 | `FAILED_PRECONDITION` | Streaming, task subscription, or extended card                                                                          |
| `PUSH_NOTIFICATION_NOT_SUPPORTED` |  400 | `FAILED_PRECONDITION` | A push notification configuration route                                                                                 |
| `TASK_NOT_FOUND`                  |  404 | `NOT_FOUND`           | A request supplies a `taskId` or calls task lookup/cancel                                                               |
| `INTERNAL`                        |  500 | `INTERNAL`            | Unexpected provider error                                                                                               |

The reason is stored at `error.details[0].reason`. Do not infer the reason
from the HTTP code alone: several operations share a status.

## Troubleshooting

### Empty `401 Unauthorized`

Check that:

- `Authorization` is `Bearer <JWT>` and the JWT is signed by a registered,
  enabled platform's current JWKS key.
- `iss` exactly matches the registered issuer and `aud` is the audience the
  provider assigned at registration.
- `sub`, `iat`, and `exp` are present, and the token has not expired.
- The signing algorithm is `RS256` or `ES256`.

The response includes `WWW-Authenticate: Bearer realm="a2a"` and has no A2A
JSON body.

### Empty `404 Not Found`

An empty `404` means the method/path did not match, or an authenticated
request addressed an unknown Customer ID. Route matching happens before
authentication. The Agent Card lookup is public and also returns an empty
`404` for an unknown Customer.

Task-specific paths have a different result: they return an A2A JSON
`TASK_NOT_FOUND` error.

### `INVALID_PARAMS`

Check that the body is valid JSON with a `ROLE_USER` message, a nonblank text
part, and no `taskId`. When continuing, use the exact context ID returned by
the previous reply with the same Customer and platform `sub`. For `GET tasks`,
`pageSize` must be a decimal integer from 1 through 100.

See [authentication](/guides/authentication) for token construction and
[messaging](/guides/messaging) for request examples.

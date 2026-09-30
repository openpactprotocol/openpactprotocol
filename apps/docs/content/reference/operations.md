---
title: HTTP+JSON operations
description: Route, method, success response, and authentication behavior for PAC2 v1.
---

Operation paths below are relative to the interface URL selected from the
Agent Card. The customer-specific base is
`{PROVIDER_URL}/a2a/{customerId}`.

## Route table

| Method          | Relative path                                   | Result                                                              |
| --------------- | ----------------------------------------------- | ------------------------------------------------------------------- |
| `GET`           | `.well-known/agent-card.json`                   | Public Agent Card; `200`, or an empty `404` for an unknown customer |
| `POST`          | `message:send`                                  | `200` with `{ "message": Message }`                                 |
| `POST`          | `message:stream`                                | A2A `UNSUPPORTED_OPERATION` error                                   |
| `GET`           | `tasks`                                         | `200` with an empty `ListTasksResponse`                             |
| `GET`           | `tasks/{id}`                                    | A2A `TASK_NOT_FOUND` error                                          |
| `POST`          | `tasks/{id}:cancel`                             | A2A `TASK_NOT_FOUND` error                                          |
| `POST`          | `tasks/{id}:subscribe`                          | A2A `UNSUPPORTED_OPERATION` error                                   |
| `GET`, `POST`   | `tasks/{id}/pushNotificationConfigs`            | A2A `PUSH_NOTIFICATION_NOT_SUPPORTED` error                         |
| `GET`, `DELETE` | `tasks/{id}/pushNotificationConfigs/{configId}` | A2A `PUSH_NOTIFICATION_NOT_SUPPORTED` error                         |
| `GET`           | `extendedAgentCard`                             | A2A `UNSUPPORTED_OPERATION` error                                   |

All A2A JSON responses use `application/a2a+json`. The public Agent Card
includes `Cache-Control: public, max-age=300`.

## Authentication and route matching

The Agent Card is public. For other matched operations the provider
authenticates the bearer JWT before customer lookup and before parsing a
message body. Authentication failures are empty `401` responses with
`WWW-Authenticate: Bearer realm="a2a"`. An authenticated request for an
unknown customer gets an empty `404`.

Paths and methods are matched before authentication. Any unlisted path or
wrong method returns a `404` (or `405`) without an A2A error body. For example,
`POST tasks/{id}` is not the `GET tasks/{id}` operation.

## Task compatibility routes

PAC2 v1 does not create task resources. `GET tasks` ignores query parameters
other than `pageSize`; the page size defaults to 50 and must be an integer
from 1 through 100. A successful response is:

```json
{
  "tasks": [],
  "nextPageToken": "",
  "pageSize": 50,
  "totalSize": 0
}
```

Task lookup and cancellation return `TASK_NOT_FOUND` with
`Task not found: {id}`; they do not look up a conversation by task ID. If
`message:send` contains `taskId`, the same reason is returned with
`Task not found`. Streaming, subscriptions, and extended cards return
`UNSUPPORTED_OPERATION` with `Unsupported operation`. Push notification
configuration routes return `PUSH_NOTIFICATION_NOT_SUPPORTED` with
`Push notifications are not supported`.

See the [messaging guide](/guides/messaging) for the `message:send` request
body, continuation, and retry rules.

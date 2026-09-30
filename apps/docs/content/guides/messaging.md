---
title: Messaging and context
description: Send text messages, continue a context, and handle message retries safely.
---

The v1 send operation is an HTTP+JSON request to the customer-specific
interface:

```http
POST {interfaceUrl}/message:send
Authorization: Bearer <platform-jwt>
A2A-Version: 1.0
Content-Type: application/json
```

The reference client sends both `A2A-Version: 1.0` and
`Content-Type: application/json`. The provider does not currently enforce
those request headers. A2A JSON responses use
`Content-Type: application/a2a+json`.

## Start a conversation

Send a user message without `contextId` to start a new conversation:

```json
{
  "message": {
    "messageId": "message-001",
    "role": "ROLE_USER",
    "parts": [{ "text": "I need help with my account." }]
  }
}
```

The response body contains the agent's Message:

```json
{
  "message": {
    "messageId": "reply-001",
    "contextId": "f0c12e6b-231e-4d92-a610-2518a0f27d20",
    "role": "ROLE_AGENT",
    "parts": [{ "text": "I can help. What do you need to change?" }]
  }
}
```

Save `contextId` from the response. The provider creates it as a UUID and
returns it on every reply. It is conversation context, not a login token.

## Continue a context

Include the returned `contextId` in the next user Message:

```json
{
  "message": {
    "messageId": "message-002",
    "contextId": "f0c12e6b-231e-4d92-a610-2518a0f27d20",
    "role": "ROLE_USER",
    "parts": [{ "text": "Please update my mailing address." }]
  }
}
```

A context belongs to both the selected Customer and the authenticated
`{platform}:{sub}` user. A missing or foreign context returns `INVALID_PARAMS`
with `Unknown contextId`; the response does not reveal whether another
Customer or user owns it.

## Text and message IDs

The request body is a `SendMessageRequest` with a `message`; optional
`configuration` and `metadata` are accepted, and the reference provider ignores
configuration semantics. The user message must use `ROLE_USER`, include a
nonblank text part, and omit `taskId`. Non-text parts return
`CONTENT_TYPE_NOT_SUPPORTED`. A supplied `taskId` returns `TASK_NOT_FOUND`.

Give each user Message a unique `messageId` within its context. If the same
user `messageId` is received again in that context, the provider returns the
stored agent reply that followed it, without running the agent again. If the
original user message has no stored reply yet, the provider returns
`INVALID_PARAMS`. A retry without `contextId` starts a new conversation, so
the retry-safe pattern is to repeat both the context and message ID.

{% callout type="note" %}
Do not depend on a particular answer format or sample skill. Agent behavior is
defined by each Customer's support agent; PAC2 defines the message and
conversation boundary.
{% /callout %}

See [operations](/reference/operations) for supported paths and
[errors](/reference/errors) for response bodies and status codes.

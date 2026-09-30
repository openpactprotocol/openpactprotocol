---
title: Agent Card discovery
description: Find the customer-specific A2A interface and read the public Agent Card.
---

Fetch the public Agent Card using the Customer ID:

```http
GET {PROVIDER_URL}/a2a/{customerId}/.well-known/agent-card.json
```

The reference provider responds with `application/a2a+json` and
`Cache-Control: public, max-age=300`. No bearer token is required. An unknown
customer ID returns an empty `404`.

## Example card

This example reflects the Skyline Airways card returned by the reference
provider.

```json
{
  "name": "Skyline Airways",
  "description": "Flight status and trip changes.",
  "supportedInterfaces": [
    {
      "url": "https://provider.example.com/a2a/01M3R53Q5SZQ6FQSMSDBSSREAA",
      "protocolBinding": "HTTP+JSON",
      "protocolVersion": "1.0"
    }
  ],
  "provider": {
    "organization": "Decagon (PAC2 test harness)",
    "url": "https://provider.example.com"
  },
  "version": "0.1.0",
  "capabilities": {
    "streaming": false,
    "pushNotifications": false,
    "extendedAgentCard": false
  },
  "securitySchemes": {
    "platformJwt": {
      "httpAuthSecurityScheme": {
        "scheme": "Bearer",
        "bearerFormat": "JWT",
        "description": "JWT signed by a registered Personal Agent platform; aud is the platform's registered audience (default {base}/a2a)"
      }
    }
  },
  "securityRequirements": [
    {
      "schemes": {
        "platformJwt": {
          "list": []
        }
      }
    }
  ],
  "defaultInputModes": ["text/plain"],
  "defaultOutputModes": ["text/plain"],
  "skills": [
    {
      "id": "flight-status",
      "name": "Flight status",
      "description": "Check departure and arrival times for a booked flight.",
      "tags": [
        "flight",
        "flights",
        "airline",
        "delay",
        "delayed",
        "departure",
        "boarding",
        "gate",
        "trip"
      ],
      "examples": ["Is my Friday flight on time?"]
    }
  ]
}
```

## Fields to use

1. Select the entry in `supportedInterfaces` whose
   `protocolBinding` is `HTTP+JSON` and `protocolVersion` is `1.0`.
2. Use its `url` as the interface base for `message:send` and task
   compatibility routes.
3. Read `securitySchemes.platformJwt` to learn that the interface uses a
   bearer JWT. The audience is provider-wide and assigned at registration,
   not the customer-specific `url`.

An Agent Card is metadata and does not register or authenticate a platform.
Continue with the [authentication guide](/guides/authentication) before
sending a message.

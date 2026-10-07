---
title: Action checks with AffixIO
description: An optional Provider example for checking delegated tool actions through the AffixIO API, SDK or MCP service.
---

The [Delegated profile](./spec.md#5-delegated-authority) establishes whose
account a personal agent can use and which scopes the User granted. A Brand may
also need to check a particular action: a flight change must be free, a refund
must stay within a limit, or a tool must only operate on permitted resources.

`reference/affixio` demonstrates such a check using AffixIO. The Provider owns
the policy and the tool implementation. An explicit allow decision is required
before the operation runs. A denial, review decision, malformed response or
unavailable service leaves the operation unexecuted.

This is an optional integration example. It introduces no normative PACT
requirements, changes no Agent Cards and adds no dependency to the existing
Provider or personal-agent client. AffixIO is not needed to implement PACT.

## Where it runs

1. Verify the personal-agent JWT and delegation token using the existing
   [Provider flow](./provider.md). Check the grant is still active.
2. Resolve the Brand, User and conversation from authenticated server state.
   Apply PACT's context ownership and duplicate-message rules.
3. Resolve the requested tool and its arguments using a server-owned registry.
   Derive resources and prices from trusted Brand data.
4. Check the User's scopes. If scopes are missing, use PACT's existing
   `TASK_STATE_AUTH_REQUIRED` flow before contacting AffixIO.
5. Check the exact action against the Brand's policy through one of the
   adapters below. Recheck the grant before execution.
6. Execute the tool, record the action and issue the normal signed PACT receipt.
   Store the AffixIO evidence alongside that receipt on the Provider.

The guard wraps the actual tool operation, not the model's statement that a
tool should run. Keep it on the Provider even when the personal agent also
performs its own checks.

## Run the example

```sh
pnpm install
pnpm --filter @openpactprotocol/affixio-example demo
pnpm exec vitest run reference/affixio/test
```

The offline demo labels its decision as a fixture. Its booking is simulated.
It uses a synthetic authorized context to show allow and missing-scope paths;
it does not perform OAuth, verify real tokens or generate cryptographic proof.

To request an actual API decision while keeping the booking simulated:

```sh
AFFIX_API_KEY="$AFFIX_API_KEY" pnpm --filter @openpactprotocol/affixio-example demo --live
```

Use a valid server-side AffixIO API key with access to the decision endpoint.
This requests attestation and audit and can consume the account's allowance.
Keep API keys out of browser code, prompts, tool arguments and PACT metadata.

## Connect a Provider tool

The example's `createActionGuard` accepts a fixed Brand, a secret of at least
32 bytes, a trusted tool registry, an authorizer and `getAuthorization`.

`getAuthorization` is a **trusted server callback**, not a token decoder. It
must return the outcome of the Provider's authentication, delegation and grant
checks for this request. Never pass model-supplied objects or merely decoded
JWT claims into it. It is called again after the decision to detect a revoked,
expired or changed grant.

| Authorization field | Source                                                              |
| ------------------- | ------------------------------------------------------------------- |
| `brand`             | Exact Brand interface URL for this route                            |
| `pa`                | Verified personal-agent issuer, bound to delegation `client_id`     |
| `paSubject`         | Verified personal-agent JWT `sub`                                   |
| `user`              | Verified delegation token `sub`                                     |
| `grantId`           | Verified delegation token `grant_id`, checked against active grants |
| `scopes`            | Verified delegation scopes                                          |
| `expiresAt`         | Earliest expiry of the verified credentials, in milliseconds        |

Keep the Brand's resource ownership checks as well as scope checks. A valid
`flights:rebook` scope does not make someone else's booking accessible.

The registry supplies each tool's argument parser, scope requirements,
resource and amount mapper, and policy. The example accepts strict JSON
arguments and nonnegative safe-integer minor-unit amounts. The policy has
explicit action, tool, resource and Brand allowlists and a currency and amount
limit. Human approval flags must come from trusted Brand policy state.

The runnable implementation uses `rebook_trip` with `flights:rebook` and a
zero-fee limit. To adapt the same boundary to another tool, replace its parser,
mapper, policy and execution callback together.

```ts
const checked = await guard.execute(
  {
    tool: "rebook_trip",
    args: validatedRebooking,
    contextId,
    messageId,
    actionId: "rebook-1",
    signal: request.signal,
  },
  async (args, authorization) => brandApi.rebookForUser(authorization.user, args),
);

actions.push(checked.action);
await evidenceStore.save({ contextId, messageId, decision: checked.decision });
```

This excerpt shows the application-owned objects at the boundary. The complete,
runnable setup is `reference/affixio/src/demo.ts`. In the reference Provider,
the corresponding boundary is immediately before the calls in
`reference/provider/src/delegation/agent.ts`; its `actions` feed the existing
receipt-signing path.

For a missing-scope `ActionBlocked`, use its `missingScopes` in the existing
PACT step-up flow. A policy denial or review requirement is not automatically
a missing OAuth scope. Return an accurate business response and keep the
conversation open. An unavailable decision service must not trigger a fallback
that executes the action.

## API transport

`createApiAuthorizer({ apiKey })` calls the existing endpoint:

```http
POST https://api.affix-io.com/v1/sdk2/actions/decide
X-API-Key: <server-side AffixIO key>
Content-Type: application/json
```

The body contains `agent`, `action`, `policy` and a bound `context`, with
`audit: true` and `request_attestation: true`. AffixIO's `yes`, `no` and `review`
map to the guard's `allow`, `deny` and `review`. Both the outcome and `allowed`
flag must agree. The adapter verifies that the returned action, policy, actor,
context and their digests match the request.

HTTP failures, redirects, timeouts, missing evidence and inconsistent responses
block execution. The adapter makes one request and does not automatically retry
an action. HTTPS is required, including for a configured alternate origin.

The API returns a policy decision with an evidence envelope, attestation and
audit data. Checking hashes and receiving an ML-DSA-65 signature do not establish
that the signature is valid. This example explicitly records
`signatureVerified: false`; it relies on its configured HTTPS service for the
online decision. For independent verification, verify the signature with a
trusted AffixIO key and verify Merkle inclusion against a trusted tree root.
Do not describe the API decision as a zero-knowledge proof of the User's consent
or of the truth of the submitted action.

## Local SDK transport

The adapter accepts the published SDK's `evaluatePolicy` function. Install the
SDK only in the application choosing this route:

```sh
npm install affixio@2.0.0-beta.1
```

```ts
import { evaluatePolicy } from "affixio/workflows";
import { createSdkAuthorizer } from "./sdk.js";

const authorize = createSdkAuthorizer(evaluatePolicy);
```

The adapter maps the same explicit action constraints into SDK observations,
binds the input digest and bounds validity by the credential expiry. Local
evaluation returns a decision record. It does not contact the API or generate
a remote attestation, Merkle inclusion proof or zero-knowledge proof. An API key
is needed when using authenticated AffixIO API services, not for this local
policy function.

The SDK is injected so the base PACT checkout does not install its proving
runtime and cryptography dependencies. This example uses the 2.0 beta workflow
API; it does not claim compatibility with 1.4.1's exports.

## MCP transport and tool visibility

`createMcpAuthorizer(client)` accepts a connected MCP client with `callTool`.
Connect and authenticate it to AffixIO's MCP service first. The existing service
uses OAuth and this write operation needs `mcp:write`.

The adapter invokes `affix_api_write` with `method: "POST"`, the decision path
above and the same bound body. It understands both the service's direct result
and its `{ result, agentic_guard }` wrapper. MCP errors and malformed tool
results block execution. Caller cancellation is forwarded to the MCP client.

```ts
import { createMcpAuthorizer } from "./mcp.js";

const authorize = createMcpAuthorizer(authenticatedAffixMcpClient);
```

This uses MCP as the decision transport; it does not put the AffixIO API key in
an agent prompt. A Provider exposing its own tools through MCP can use
`guard.listTools()` to filter the tools visible under the current grant, then
use `guard.execute()` inside every corresponding `tools/call` handler. Hiding
a tool is not enough: invocation still needs scope and policy checks.

## Evidence, privacy and receipts

PACT's `pact.receipt` stays unchanged and is signed with the Provider's existing
keys. The guard returns a `ReceiptAction` for the executed tool, using the same
SHA-256/base64url argument-hash convention as the reference Provider. Add it
only after successful execution.

Keep the AffixIO result in Provider storage alongside the PACT receipt. Do not
insert the raw API result into User-visible metadata by default: it can contain
policy and account details. If sharing evidence, define and review a separate
minimal representation rather than changing `pact.receipt` claims.

Outbound API/MCP requests include the tool, configured resource, Brand interface
URL, amount, currency and policy. User, grant and conversation identifiers are
bound using HMAC-SHA-256 with a Provider secret. Raw tool arguments are replaced
by a keyed digest. Neither PACT token is sent to AffixIO. These bindings are
pseudonymous commitments, not a claim of anonymity; action metadata can still
be sensitive. Configure resource labels accordingly.

Keep the binding secret stable and private in the Provider's secret store.
Plan rotation and evidence retention together. The demo generates an ephemeral
secret only because its entire execution is disposable.

## Execution and deployment limits

The guard takes a JSON snapshot of the parsed arguments before awaiting a
decision and uses that same snapshot for execution. It binds the PA, User,
Brand, grant, context, message, action, arguments and policy. Changed consent or
an expired token after the decision blocks the action.

The surrounding Provider must still implement PACT's duplicate-message storage
and concurrency control. The guard itself is not an exactly-once executor and
does not reserve budgets. Use transactional Brand operations, idempotency keys
and resource-version checks when the effect matters. Recheck mutable account
state atomically at the Brand API: consent can change immediately after any
remote preflight check. An ambiguous tool timeout must be reconciled before a
retry; the guard cannot determine whether a remote effect already happened.

Run the existing [conformance suite](./running.md#conformance-tests) for a
Provider adopting this example, plus its Brand-specific execution tests. The
example's tests exercise the additional guard and transports, not a replacement
for PACT conformance or a production security certification.

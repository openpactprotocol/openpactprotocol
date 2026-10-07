# AffixIO action guard example

An optional Provider integration for checking a delegated action immediately
before its tool executes. Supports the AffixIO API, the existing AffixIO MCP
service, and local evaluation with `affixio@2.0.0-beta.1`.

PACT remains responsible for identity, consent, scope step-up and signed
receipts. This example adds a Provider-controlled action policy. It does not
change PACT's wire format or require AffixIO for other implementations.

Read [the integration guide](../../docs/affixio.md) for the trust boundary,
configuration, data sent to AffixIO, receipt handling and deployment limits.

## Run

From the repository root:

```sh
pnpm install
pnpm --filter @openpactprotocol/affixio-example demo
pnpm exec vitest run reference/affixio/test
```

The default demo uses an explicit decision fixture and a simulated booking.
It shows an allowed operation followed by a missing-consent block. It does not
contact AffixIO, authenticate a real PACT user or create a proof.

For a real API decision with the same simulated booking:

```sh
AFFIX_API_KEY="$AFFIX_API_KEY" pnpm --filter @openpactprotocol/affixio-example demo --live
```

The API requires a valid AffixIO key and sufficient account access or allowance.
The live call requests attestation and an audit entry and may consume allowance.
It never books a flight or handles a payment.

To check against the actual SDK, install `affixio@2.0.0-beta.1` in an isolated
application or temporary directory, then point the smoke test at its workflow
module:

```sh
AFFIX_SDK_MODULE=/absolute/path/node_modules/affixio/dist/runtime/index.js \
pnpm --filter @openpactprotocol/affixio-example test:sdk
```

This runs real SDK evaluation for an allowed zero-fee action and a denied
over-limit action. No API key or network call is involved. The normal workspace
tests use transport fixtures; neither suite claims to verify remote signatures.

## Files

| File | Purpose |
| --- | --- |
| `src/guard.ts` | Scope checks, action binding, deadline, consent recheck and execution |
| `src/api.ts` | Authenticated HTTPS request and strict evidence binding checks |
| `src/sdk.ts` | Adapter for the SDK's local `evaluatePolicy` function |
| `src/mcp.ts` | Adapter for an authenticated MCP client's `callTool` |
| `src/demo.ts` | Runnable fixture and opt-in API demonstration |
| `test/` | Execution, consent, isolation, transport and failure tests |

Contributed by [AffixIO](https://www.affix-io.com/). This is an optional integration
example, not a PACT endorsement, certification or conformance claim.

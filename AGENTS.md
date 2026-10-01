# AGENTS.md

This repository is the PACT protocol: specification, integration guides, a
reference Provider, a demo PA, a TypeScript PA client, and a conformance suite.
Terms: **Provider** hosts Brands' support agents; **Brand** is a business;
**PA** is a personal-agent platform; **User** is the PA's user.

## If you are integrating another codebase

- Making a personal-agent platform speak PACT → follow `docs/personal-agent.md`
  step by step. The client to import or copy is
  `packages/client/src/index.ts`.
- Making a platform that hosts support agents speak PACT → follow
  `docs/provider.md`. Prove it with `E2E_PROVIDER=any pnpm e2e` (10 tests).
- Exact rules and wire formats → `docs/spec.md`. It is the only normative
  document; guides restate it.

## If you are changing this repository

- Setup: `pnpm install && pnpm gen-keys`. Local stack: `docs/running.md`.
- Checks: `pnpm lint && pnpm typecheck && pnpm test && pnpm format:check`.
- Docs live in `docs/` and are rendered by `website/`. Use relative `.md`
  links (`spec.md#4-messages`); every `docs/*.md` must be listed in
  `website/src/nav.ts`; `pnpm vitest run website` validates links and anchors.
- The code calls Brands `customers` (`CUSTOMER_ID`, `customers` table). Docs
  say Brand.
- Never commit `reference/personal-agent/server/public/.well-known/jwks.json`
  changes or any `.env.local`.

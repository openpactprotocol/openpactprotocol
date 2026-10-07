import { z } from "zod";
import { digest, type Authorization, type DecisionRequest, type Tool } from "../src/guard.js";

export const NOW = 1_800_000_000_000;
export const brand = "https://provider.example/a2a/skyline";
export const secret = "test-only-binding-secret-32-bytes-long";
export function authorization(): Authorization {
  return {
    brand,
    pa: "https://pa.example",
    paSubject: "pa-private-user",
    user: "brand-private-user",
    grantId: "private-grant",
    scopes: ["flights:rebook"],
    expiresAt: NOW + 60_000,
  };
}
export function tool(): Tool {
  return {
    name: "rebook_trip",
    requiredScopes: ["flights:rebook"],
    parse: (args) =>
      z
        .object({ flight: z.string().min(1) })
        .strict()
        .parse(args),
    describe: () => ({ resource: "skyline:rebooking", amountMinor: 0, currency: "GBP" }),
    policy: {
      id: "free-rebook-v1",
      allowed_actions: ["rebook_trip"],
      allowed_tools: ["rebook_trip"],
      allowed_resources: ["skyline:rebooking"],
      max_amount_minor: 0,
      currency: "GBP",
      require_human_approval: false,
      human_approved: false,
      review_on_unknown: false,
    },
  };
}
export function action() {
  return {
    tool: "rebook_trip",
    args: { flight: "SK 102" },
    contextId: "private-context",
    messageId: "private-message",
    actionId: "rebook-1",
  };
}
export function apiResponse(request: DecisionRequest, decision: "yes" | "no" | "review" = "yes") {
  const body = {
    schema: "affix.sdk2.evidence.v1",
    sdk_version: "2.0.0-beta.1",
    evidence_id: "ev_fixture",
    created_at: new Date(NOW).toISOString(),
    mode: "agent_action",
    decision,
    allowed: decision === "yes",
    reason_codes: [],
    action_digest: digest(request.action),
    policy_digest: digest(request.policy),
    api_key_id: "fixture-key-id",
    subject: request.agent,
    action: request.action,
    policy: request.policy,
    context: request.context,
  };
  const hash = digest(body);
  return {
    ok: true,
    decision,
    allowed: decision === "yes",
    digest: hash,
    proof_ref: `1:${hash}`,
    evidence: { ...body, digest: hash },
    attestation: {
      algorithm: "ML-DSA-65",
      payload_digest: "fixture-not-a-signature",
      mldsa_signature_b64: "fixture",
    },
    merkle: { fixture: true },
  };
}

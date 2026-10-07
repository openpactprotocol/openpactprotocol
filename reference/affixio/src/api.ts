import { z } from "zod";
import {
  canonical,
  digest,
  type Authorize,
  type Decision,
  type DecisionRequest,
  type Json,
} from "./guard.js";

export const DECISION_PATH = "/v1/sdk2/actions/decide";

const ResponseSchema = z
  .object({
    ok: z.literal(true),
    decision: z.enum(["yes", "no", "review"]),
    allowed: z.boolean(),
    evidence: z
      .object({
        schema: z.literal("affix.sdk2.evidence.v1"),
        decision: z.enum(["yes", "no", "review"]),
        allowed: z.boolean(),
        action: z.record(z.string(), z.json()),
        policy: z.record(z.string(), z.json()),
        subject: z.record(z.string(), z.json()),
        context: z.record(z.string(), z.json()),
        action_digest: z.string(),
        policy_digest: z.string(),
        digest: z.string(),
      })
      .passthrough(),
    digest: z.string(),
    proof_ref: z.string().min(1),
    attestation: z
      .object({
        algorithm: z.literal("ML-DSA-65"),
        payload_digest: z.string().min(1),
        mldsa_signature_b64: z.string().min(1),
      })
      .passthrough(),
    merkle: z.record(z.string(), z.json()),
  })
  .passthrough();

export function parseApiDecision(raw: unknown, request: DecisionRequest): Decision {
  const result = ResponseSchema.parse(raw);
  const evidence = result.evidence;
  if (
    result.allowed !== (result.decision === "yes") ||
    evidence.decision !== result.decision ||
    evidence.allowed !== result.allowed
  )
    throw new Error("Inconsistent decision");
  for (const [actual, expected] of [
    [evidence.action, request.action],
    [evidence.policy, request.policy],
    [evidence.subject, request.agent],
    [evidence.context, request.context],
  ] as const) {
    if (canonical(actual as Json) !== canonical(expected))
      throw new Error("Decision does not match request");
  }
  if (
    evidence.action_digest !== digest(request.action) ||
    evidence.policy_digest !== digest(request.policy)
  )
    throw new Error("Invalid action or policy digest");
  const unsigned = { ...evidence };
  delete (unsigned as Partial<typeof unsigned>).digest;
  if (digest(unsigned as Json) !== evidence.digest || result.digest !== evidence.digest)
    throw new Error("Invalid evidence digest");
  return {
    decision: result.decision === "yes" ? "allow" : result.decision === "no" ? "deny" : "review",
    binding: request.context.binding,
    evidence: {
      transport: "affixio-api",
      signatureVerified: false,
      response: z.json().parse(raw) as Json,
    },
  };
}

export function createApiAuthorizer(options: {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}): Authorize {
  if (!options.apiKey.trim()) throw new Error("An AffixIO API key is required");
  const url = new URL(options.baseUrl ?? "https://api.affix-io.com");
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error("An HTTPS API origin is required");
  const endpoint = new URL(DECISION_PATH, url);
  return async (request, signal) => {
    const response = await (options.fetchImpl ?? fetch)(endpoint, {
      method: "POST",
      redirect: "error",
      cache: "no-store",
      signal,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-API-Key": options.apiKey,
      },
      body: JSON.stringify(request),
    });
    if (!response.ok) throw new Error(`AffixIO decision request failed (${response.status})`);
    return parseApiDecision(await response.json(), request);
  };
}

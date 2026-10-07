import { z } from "zod";
import { digest, type Authorize, type Json } from "./guard.js";

export type SdkPolicy = {
  id: string;
  version: string;
  mode: "all";
  rules: { source: string; operator: "truthy"; maxAgeMs: number }[];
};

export type SdkObservation = {
  source: string;
  status: "ok";
  value: boolean;
  observedAt: number;
  expiresAt: number;
};

export type SdkEvaluatePolicy = (
  policy: SdkPolicy,
  observations: SdkObservation[],
  options: { now: number; input: Json },
) => unknown;

export function createSdkAuthorizer(
  evaluatePolicy: SdkEvaluatePolicy,
  clock: () => number = Date.now,
): Authorize {
  return async (request, signal) => {
    signal.throwIfAborted();
    const now = clock();
    const { action, policy } = request;
    const checks = {
      action: policy.allowed_actions.includes(action.type),
      tool: policy.allowed_tools.includes(action.tool),
      resource: policy.allowed_resources.includes(action.resource),
      merchant: policy.allowed_merchants.includes(action.merchant),
      amount: action.amount_minor <= policy.max_amount_minor,
      currency: action.currency === policy.currency,
      approval: !policy.require_human_approval || policy.human_approved,
    };
    const sdkPolicy: SdkPolicy = {
      id: policy.id,
      version: "1",
      mode: "all",
      rules: Object.keys(checks).map((source) => ({ source, operator: "truthy", maxAgeMs: 5_000 })),
    };
    const observations: SdkObservation[] = Object.entries(checks).map(([source, value]) => ({
      source,
      status: "ok",
      value,
      observedAt: now,
      expiresAt: request.context.authorization_expires_at,
    }));
    const input: Json = request;
    const raw = evaluatePolicy(sdkPolicy, observations, { now, input });
    const result = z
      .object({
        schema: z.literal("affix.decision.v1"),
        decision: z.enum(["allow", "deny", "review"]),
        inputDigest: z.string(),
        validUntil: z.number(),
      })
      .passthrough()
      .parse(raw);
    if (result.inputDigest !== digest(input) || result.validUntil <= clock())
      throw new Error("Invalid SDK decision");
    signal.throwIfAborted();
    return {
      decision: result.decision,
      binding: request.context.binding,
      evidence: {
        transport: "affixio-sdk",
        signatureVerified: false,
        response: z.json().parse(raw) as Json,
      },
    };
  };
}

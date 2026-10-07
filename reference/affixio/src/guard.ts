import { createHash, createHmac } from "node:crypto";
import { z } from "zod";
import type { ReceiptAction } from "@openpactprotocol/protocol/delegation";

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export function canonical(value: Json): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key]!)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function digest(value: Json): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

const AuthorizationSchema = z.object({
  brand: z.string().url(),
  pa: z.string().url(),
  paSubject: z.string().min(1),
  user: z.string().min(1),
  grantId: z.string().min(1),
  scopes: z.array(z.string().min(1)),
  expiresAt: z.number().int().positive(),
});

export type Authorization = z.infer<typeof AuthorizationSchema>;
export type Policy = {
  id: string;
  allowed_actions: string[];
  allowed_tools: string[];
  allowed_resources: string[];
  allowed_merchants: string[];
  max_amount_minor: number;
  currency: string;
  require_human_approval: boolean;
  human_approved: boolean;
  review_on_unknown: false;
};

export type DecisionRequest = {
  agent: { id: string; type: "agent" };
  action: {
    id: string;
    type: string;
    tool: string;
    resource: string;
    merchant: string;
    amount_minor: number;
    currency: string;
    metadata: { args_digest: string };
  };
  policy: Policy;
  context: { binding: string; authorization_expires_at: number };
  audit: true;
  request_attestation: true;
};

export type Decision = {
  decision: "allow" | "deny" | "review";
  binding: string;
  evidence: Json;
};

export type Authorize = (request: DecisionRequest, signal: AbortSignal) => Promise<Decision>;

export type Tool = {
  name: string;
  requiredScopes: string[];
  parse: (args: unknown) => Json;
  describe: (args: Json) => { resource: string; amountMinor: number; currency: string };
  policy: Omit<Policy, "allowed_merchants">;
};

export class ActionBlocked extends Error {
  constructor(
    readonly reason:
      | "scope_required"
      | "authorization_invalid"
      | "tool_unavailable"
      | "deny"
      | "review"
      | "decision_unavailable",
    readonly missingScopes: string[] = [],
  ) {
    super(`Action blocked: ${reason}`);
    this.name = "ActionBlocked";
  }
}

export function createActionGuard(options: {
  brand: string;
  bindingSecret: string;
  tools: Tool[];
  getAuthorization: () => Promise<Authorization>;
  authorize: Authorize;
  timeoutMs?: number;
  clock?: () => number;
}) {
  const brand = z.string().url().parse(options.brand);
  if (Buffer.byteLength(options.bindingSecret) < 32)
    throw new Error("A binding secret of at least 32 bytes is required");
  const tools = new Map(
    options.tools.map((tool) => [
      tool.name,
      { ...tool, requiredScopes: [...tool.requiredScopes], policy: structuredClone(tool.policy) },
    ]),
  );
  if (tools.size !== options.tools.length) throw new Error("Duplicate tools");
  for (const tool of tools.values()) {
    if (!tool.name || !tool.requiredScopes.length)
      throw new Error("Tools require a name and consent scopes");
    z.number().int().nonnegative().safe().parse(tool.policy.max_amount_minor);
    z.string()
      .regex(/^[A-Z]{3}$/)
      .parse(tool.policy.currency);
  }
  const timeoutMs = z
    .number()
    .int()
    .positive()
    .max(30_000)
    .parse(options.timeoutMs ?? 5_000);
  const clock = options.clock ?? Date.now;
  const bind = (value: Json) =>
    createHmac("sha256", options.bindingSecret).update(canonical(value)).digest("hex");

  async function authorization() {
    let result: Authorization;
    try {
      result = AuthorizationSchema.parse(await options.getAuthorization());
    } catch {
      throw new ActionBlocked("authorization_invalid");
    }
    if (result.brand !== brand || result.expiresAt <= clock())
      throw new ActionBlocked("authorization_invalid");
    return result;
  }

  function requireScopes(auth: Authorization, tool: Tool) {
    const missing = tool.requiredScopes.filter((scope) => !auth.scopes.includes(scope));
    if (missing.length) throw new ActionBlocked("scope_required", missing);
  }

  return {
    async listTools(): Promise<string[]> {
      const auth = await authorization();
      return [...tools.values()]
        .filter((tool) => tool.requiredScopes.every((scope) => auth.scopes.includes(scope)))
        .map((tool) => tool.name);
    },

    async execute<T>(
      input: {
        tool: string;
        args: unknown;
        contextId: string;
        messageId: string;
        actionId: string;
        signal?: AbortSignal;
      },
      operation: (args: Json, auth: Authorization) => Promise<T>,
    ): Promise<{ value: T; action: ReceiptAction; decision: Decision }> {
      input.signal?.throwIfAborted();
      const tool = tools.get(input.tool);
      if (!tool) throw new ActionBlocked("tool_unavailable");
      const auth = await authorization();
      requireScopes(auth, tool);
      const args = z.json().parse(structuredClone(tool.parse(input.args))) as Json;
      const description = tool.describe(structuredClone(args));
      z.string().min(1).parse(description.resource);
      z.number().int().nonnegative().safe().parse(description.amountMinor);
      z.string()
        .regex(/^[A-Z]{3}$/)
        .parse(description.currency);
      for (const id of [input.contextId, input.messageId, input.actionId])
        z.string().min(1).parse(id);
      const actorId = bind({ brand, pa: auth.pa, paSubject: auth.paSubject, user: auth.user });
      const policy = { ...structuredClone(tool.policy), allowed_merchants: [brand] };
      const action: DecisionRequest["action"] = {
        id: bind({
          actorId,
          contextId: input.contextId,
          messageId: input.messageId,
          actionId: input.actionId,
        }),
        type: tool.name,
        tool: tool.name,
        resource: description.resource,
        merchant: brand,
        amount_minor: description.amountMinor,
        currency: description.currency,
        metadata: { args_digest: bind(args) },
      };
      const binding = bind({ auth: { ...auth, scopes: [...auth.scopes].sort() }, action, policy });
      const request: DecisionRequest = {
        agent: { id: actorId, type: "agent" },
        action,
        policy,
        context: { binding, authorization_expires_at: auth.expiresAt },
        audit: true,
        request_attestation: true,
      };
      const controller = new AbortController();
      const abort = () => controller.abort();
      input.signal?.addEventListener("abort", abort, { once: true });
      if (input.signal?.aborted) controller.abort();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let stop: (() => void) | undefined;
      let decision: Decision;
      try {
        decision = await Promise.race([
          Promise.resolve().then(() => {
            controller.signal.throwIfAborted();
            return options.authorize(structuredClone(request), controller.signal);
          }),
          new Promise<never>((_, reject) => {
            stop = () => reject(new ActionBlocked("decision_unavailable"));
            controller.signal.addEventListener("abort", stop, { once: true });
            timer = setTimeout(abort, timeoutMs);
            if (controller.signal.aborted) stop();
          }),
        ]);
        if (
          decision.binding !== binding ||
          !["allow", "deny", "review"].includes(decision.decision)
        )
          throw new Error("Invalid decision");
      } catch {
        throw new ActionBlocked("decision_unavailable");
      } finally {
        clearTimeout(timer);
        input.signal?.removeEventListener("abort", abort);
        if (stop) controller.signal.removeEventListener("abort", stop);
      }
      if (decision.decision !== "allow") throw new ActionBlocked(decision.decision);
      input.signal?.throwIfAborted();
      const current = await authorization();
      requireScopes(current, tool);
      if (
        bind({ auth: { ...current, scopes: [...current.scopes].sort() }, action, policy }) !==
        binding
      )
        throw new ActionBlocked("authorization_invalid");
      input.signal?.throwIfAborted();
      const value = await operation(structuredClone(args), current);
      return {
        value,
        action: {
          tool: tool.name,
          argsHash: createHash("sha256").update(JSON.stringify(args)).digest("base64url"),
        },
        decision,
      };
    },
  };
}

import { describe, expect, it, vi } from "vitest";
import { createActionGuard, type Authorize, type DecisionRequest } from "../src/guard.js";
import { action, authorization, brand, NOW, secret, tool } from "./fixtures.js";

function setup(authorize?: Authorize) {
  const auth = authorization();
  const decide = vi.fn(authorize ?? (async (request) => ({ decision: "allow", binding: request.context.binding, evidence: {} })));
  const operation = vi.fn(async () => "executed");
  const getAuthorization = vi.fn(async () => auth);
  const guard = createActionGuard({ brand, bindingSecret: secret, tools: [tool()], getAuthorization, authorize: decide, clock: () => NOW, timeoutMs: 20 });
  return { auth, decide, operation, getAuthorization, guard };
}

describe("PACT action guard", () => {
  it("executes only after allow and returns a PACT receipt action", async () => {
    const { guard, operation, decide, getAuthorization } = setup();
    const result = await guard.execute(action(), operation);
    expect(result.value).toBe("executed");
    expect(result.action).toEqual({ tool: "rebook_trip", argsHash: expect.stringMatching(/^[\w-]{43}$/) });
    expect(decide).toHaveBeenCalledOnce();
    expect(getAuthorization).toHaveBeenCalledTimes(2);
    expect(operation).toHaveBeenCalledOnce();
  });
  it.each(["deny", "review"] as const)("blocks %s without executing", async (decision) => {
    const { guard, operation } = setup(async (request) => ({ decision, binding: request.context.binding, evidence: {} }));
    await expect(guard.execute(action(), operation)).rejects.toMatchObject({ reason: decision });
    expect(operation).not.toHaveBeenCalled();
  });
  it("routes missing scopes to step-up before querying AffixIO", async () => {
    const { auth, guard, operation, decide } = setup();
    auth.scopes = [];
    await expect(guard.execute(action(), operation)).rejects.toMatchObject({ reason: "scope_required", missingScopes: ["flights:rebook"] });
    expect(decide).not.toHaveBeenCalled();
    expect(operation).not.toHaveBeenCalled();
    expect(await guard.listTools()).toEqual([]);
  });
  it.each(["brand", "expiresAt"] as const)("rejects invalid %s", async (field) => {
    const { auth, guard, operation } = setup();
    if (field === "brand") auth.brand = "https://provider.example/a2a/other";
    else auth.expiresAt = NOW;
    await expect(guard.execute(action(), operation)).rejects.toMatchObject({ reason: "authorization_invalid" });
    expect(operation).not.toHaveBeenCalled();
  });
  it("rejects unknown tools", async () => {
    const { guard, decide, operation } = setup();
    await expect(guard.execute({ ...action(), tool: "delete_account" }, operation)).rejects.toMatchObject({ reason: "tool_unavailable" });
    expect(decide).not.toHaveBeenCalled();
  });
  it("rejects extra model-supplied policy fields", async () => {
    const { guard, decide, operation } = setup();
    await expect(guard.execute({ ...action(), args: { flight: "SK 102", human_approved: true } }, operation)).rejects.toThrow();
    expect(decide).not.toHaveBeenCalled();
  });
  it("rechecks revocation after a decision", async () => {
    const state = setup(async (request) => {
      state.auth.scopes = [];
      return { decision: "allow", binding: request.context.binding, evidence: {} };
    });
    await expect(state.guard.execute(action(), state.operation)).rejects.toMatchObject({ reason: "scope_required" });
    expect(state.operation).not.toHaveBeenCalled();
  });
  it.each(["user", "pa", "paSubject", "grantId"] as const)("blocks changed %s during evaluation", async (field) => {
    const state = setup(async (request) => {
      state.auth[field] = field === "pa" ? "https://other-pa.example" : "other";
      return { decision: "allow", binding: request.context.binding, evidence: {} };
    });
    await expect(state.guard.execute(action(), state.operation)).rejects.toMatchObject({ reason: "authorization_invalid" });
    expect(state.operation).not.toHaveBeenCalled();
  });
  it("blocks expiry while the decision is in flight", async () => {
    const state = setup(async (request) => {
      state.auth.expiresAt = NOW;
      return { decision: "allow", binding: request.context.binding, evidence: {} };
    });
    await expect(state.guard.execute(action(), state.operation)).rejects.toMatchObject({ reason: "authorization_invalid" });
    expect(state.operation).not.toHaveBeenCalled();
  });
  it("does not let an asynchronous authorizer change the executed arguments", async () => {
    const input = action();
    const state = setup(async (request) => {
      input.args.flight = "SK 999";
      request.action.metadata.args_digest = "tampered";
      return { decision: "allow", binding: request.context.binding, evidence: {} };
    });
    await state.guard.execute(input, state.operation);
    expect(state.operation.mock.calls[0]?.[0]).toEqual({ flight: "SK 102" });
  });
  it("does not send tokens, user ids, conversation ids or raw arguments to AffixIO", async () => {
    const { guard, decide, operation } = setup();
    await guard.execute(action(), operation);
    const wire = JSON.stringify(decide.mock.calls[0]?.[0]);
    for (const privateValue of ["pa-private-user", "brand-private-user", "private-grant", "private-context", "private-message", "SK 102"]) expect(wire).not.toContain(privateValue);
  });
  it.each(["messageId", "contextId", "actionId"] as const)("binds %s separately", async (field) => {
    const { guard, decide, operation } = setup();
    await guard.execute(action(), operation);
    await guard.execute({ ...action(), [field]: "different" }, operation);
    expect(decide.mock.calls[0]?.[0].context.binding).not.toBe(decide.mock.calls[1]?.[0].context.binding);
  });
  it("rejects evidence for another action", async () => {
    const { guard, operation } = setup(async () => ({ decision: "allow", binding: "another-action", evidence: {} }));
    await expect(guard.execute(action(), operation)).rejects.toMatchObject({ reason: "decision_unavailable" });
    expect(operation).not.toHaveBeenCalled();
  });
  it("bounds even an authorizer that ignores cancellation", async () => {
    const { guard, operation } = setup(() => new Promise(() => {}));
    await expect(guard.execute(action(), operation)).rejects.toMatchObject({ reason: "decision_unavailable" });
    expect(operation).not.toHaveBeenCalled();
  });
  it("does not execute after client cancellation", async () => {
    const controller = new AbortController();
    const { guard, operation } = setup(async (request) => {
      controller.abort();
      return { decision: "allow", binding: request.context.binding, evidence: {} };
    });
    await expect(guard.execute({ ...action(), signal: controller.signal }, operation)).rejects.toThrow();
    expect(operation).not.toHaveBeenCalled();
  });
  it("propagates tool failure without retrying execution", async () => {
    const { guard, operation } = setup();
    operation.mockRejectedValueOnce(new Error("ambiguous brand result"));
    await expect(guard.execute(action(), operation)).rejects.toThrow("ambiguous brand result");
    expect(operation).toHaveBeenCalledOnce();
  });
  it("captures the full request for transport tests", async () => {
    const requests: DecisionRequest[] = [];
    const { guard, operation } = setup(async (request) => { requests.push(request); return { decision: "allow", binding: request.context.binding, evidence: {} }; });
    await guard.execute(action(), operation);
    expect(requests[0]?.policy.allowed_merchants).toEqual([brand]);
  });
});

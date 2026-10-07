import { describe, expect, it, vi } from "vitest";
import { createApiAuthorizer, parseApiDecision } from "../src/api.js";
import { createMcpAuthorizer } from "../src/mcp.js";
import { createSdkAuthorizer } from "../src/sdk.js";
import { createActionGuard, digest, type Authorize, type DecisionRequest } from "../src/guard.js";
import { action, apiResponse, authorization, brand, NOW, secret, tool } from "./fixtures.js";

function run(authorize: Authorize) {
  return createActionGuard({ brand, bindingSecret: secret, tools: [tool()], getAuthorization: async () => authorization(), authorize, clock: () => NOW }).execute(action(), async () => "executed");
}

async function requestFixture(): Promise<DecisionRequest> {
  let captured: DecisionRequest | undefined;
  await run(async (request) => { captured = request; return { decision: "allow", binding: request.context.binding, evidence: {} }; });
  return captured!;
}

describe("AffixIO API transport", () => {
  it("sends an authenticated request to the existing endpoint", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => Response.json(apiResponse(JSON.parse(String(init?.body)))));
    expect((await run(createApiAuthorizer({ apiKey: "test-only-key", fetchImpl }))).value).toBe("executed");
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe("https://api.affix-io.com/v1/sdk2/actions/decide");
    expect(init?.headers).toMatchObject({ "X-API-Key": "test-only-key" });
    expect(init?.redirect).toBe("error");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });
  it.each([401, 403, 429, 500, 503])("blocks HTTP %s", async (status) => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("secret upstream error", { status }));
    await expect(run(createApiAuthorizer({ apiKey: "test-only-key", fetchImpl }))).rejects.toMatchObject({ reason: "decision_unavailable" });
  });
  it.each(["no", "review"] as const)("blocks the API's %s result", async (decision) => {
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => Response.json(apiResponse(JSON.parse(String(init?.body)), decision)));
    await expect(run(createApiAuthorizer({ apiKey: "test-only-key", fetchImpl }))).rejects.toMatchObject({ reason: decision === "no" ? "deny" : "review" });
  });
  it.each(["http://api.example", "https://user:password@api.example", "https://api.example/?key=secret", "https://api.example/other", "https://api.example/#fragment"])("rejects unsafe API origin %s", (baseUrl) => {
    expect(() => createApiAuthorizer({ apiKey: "key", baseUrl })).toThrow();
  });
  it("requires an explicit API key", () => {
    expect(() => createApiAuthorizer({ apiKey: " " })).toThrow();
  });
  it.each(["action", "policy", "subject", "context"] as const)("rejects mismatched %s evidence", async (field) => {
    const request = await requestFixture();
    const response = apiResponse(request);
    Object.assign(response.evidence[field], { unexpected: true });
    await expect(run(async (input) => parseApiDecision(response, input))).rejects.toMatchObject({ reason: "decision_unavailable" });
  });
  it("rejects a success flag contradicted by its decision", async () => {
    const request = await requestFixture();
    const response = apiResponse(request, "no");
    response.allowed = true;
    expect(() => parseApiDecision(response, request)).toThrow("Inconsistent decision");
  });
  it.each(["action_digest", "policy_digest", "digest"] as const)("rejects altered %s", async (field) => {
    const request = await requestFixture();
    const response = apiResponse(request);
    response.evidence[field] = "invalid";
    expect(() => parseApiDecision(response, request)).toThrow();
  });
  it("does not claim hash checking verifies a signature", async () => {
    const request = await requestFixture();
    expect(parseApiDecision(apiResponse(request), request).evidence).toMatchObject({ signatureVerified: false });
  });
  it("rejects missing attestation and malformed response bodies", async () => {
    const request = await requestFixture();
    const response = apiResponse(request);
    expect(() => parseApiDecision({ ...response, attestation: undefined }, request)).toThrow();
    expect(() => parseApiDecision({ allowed: true }, request)).toThrow();
  });
});

describe("AffixIO MCP transport", () => {
  it.each([false, true])("accepts the existing MCP response (wrapped=%s)", async (wrapped) => {
    const callTool = vi.fn(async (input: { name: string; arguments: Record<string, unknown> }) => {
      const result = apiResponse(input.arguments.body as DecisionRequest);
      return { content: [{ type: "text", text: JSON.stringify(wrapped ? { result, agentic_guard: { mode: "fixture" } } : result) }] };
    });
    expect((await run(createMcpAuthorizer({ callTool }))).value).toBe("executed");
    expect(callTool.mock.calls[0]?.[0]).toMatchObject({ name: "affix_api_write", arguments: { method: "POST", path: "/v1/sdk2/actions/decide" } });
  });
  it.each([
    { isError: true, content: [{ type: "text", text: "failure" }] },
    { content: [] },
    { content: [{ type: "text", text: "not-json" }] },
    { content: [{ type: "text", text: "{}" }, { type: "text", text: "{}" }] },
  ])("blocks malformed or failed MCP responses", async (result) => {
    await expect(run(createMcpAuthorizer({ callTool: async () => result }))).rejects.toMatchObject({ reason: "decision_unavailable" });
  });
});

describe("AffixIO SDK adapter", () => {
  it("maps all action constraints into SDK policy observations", async () => {
    const evaluate = vi.fn((_policy, observations, options) => ({
      schema: "affix.decision.v1", decision: observations.every((item: { value: boolean }) => item.value) ? "allow" : "deny",
      inputDigest: digest(options.input), validUntil: NOW + 5_000,
    }));
    const result = await run(createSdkAuthorizer(evaluate, () => NOW));
    expect(result.value).toBe("executed");
    expect(evaluate.mock.calls[0]?.[1]).toHaveLength(7);
    expect(result.decision.evidence).toMatchObject({ transport: "affixio-sdk", signatureVerified: false });
  });
  it("blocks stale or unbound SDK output", async () => {
    for (const result of [
      { schema: "affix.decision.v1", decision: "allow", inputDigest: "wrong", validUntil: NOW + 5_000 },
      { schema: "affix.decision.v1", decision: "allow", inputDigest: "wrong", validUntil: NOW },
      { decision: "allow" },
    ]) await expect(run(createSdkAuthorizer(() => result, () => NOW))).rejects.toMatchObject({ reason: "decision_unavailable" });
  });
});

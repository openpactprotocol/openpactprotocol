import { z } from "zod";
import { DECISION_PATH, parseApiDecision } from "./api.js";
import type { Authorize } from "./guard.js";

export type McpClient = {
  callTool: (
    request: { name: string; arguments: Record<string, unknown> },
    resultSchema?: undefined,
    options?: { signal?: AbortSignal },
  ) => Promise<unknown>;
};

const ResultSchema = z.object({
  isError: z.boolean().optional(),
  content: z.array(z.object({ type: z.string(), text: z.string().optional() }).passthrough()),
});

export function createMcpAuthorizer(client: McpClient): Authorize {
  return async (request, signal) => {
    const result = ResultSchema.parse(
      await client.callTool(
        {
          name: "affix_api_write",
          arguments: { method: "POST", path: DECISION_PATH, body: request },
        },
        undefined,
        { signal },
      ),
    );
    if (result.isError === true) throw new Error("AffixIO MCP decision failed");
    const texts = result.content.filter((part) => part.type === "text");
    if (texts.length !== 1 || !texts[0]?.text) throw new Error("Invalid AffixIO MCP response");
    const body: unknown = JSON.parse(texts[0].text);
    const wrapped = z
      .object({
        result: z.record(z.string(), z.unknown()),
        agentic_guard: z.record(z.string(), z.unknown()),
      })
      .safeParse(body);
    return parseApiDecision(wrapped.success ? wrapped.data.result : body, request);
  };
}

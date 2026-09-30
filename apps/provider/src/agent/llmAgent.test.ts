import { afterEach, describe, expect, it, vi } from "vitest";
import { businessProfile, runAgentTurn } from "./index.js";
import { replyWithOpenAI } from "./llmAgent.js";

const customerName = "Skyline Airways";
const profile = businessProfile(customerName);
const history = [
  { role: "customer" as const, text: "Is my Friday flight delayed?" },
  { role: "agent" as const, text: "What's your confirmation code?" },
];

function completionFetch(reply: string, status: string, httpStatus = 200): typeof fetch {
  return async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ reply, status }) } }],
      }),
      { status: httpStatus },
    );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("replyWithOpenAI", () => {
  it("sends business guidance and context to the chat completions API", async () => {
    let requestedUrl = "";
    let requestInit: RequestInit | undefined;
    const fetchImpl: typeof fetch = async (input, init) => {
      requestedUrl = String(input);
      requestInit = init;
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  reply: "  Flight SK 482 is delayed.  ",
                  status: "needs_detail",
                }),
              },
            },
          ],
        }),
        { status: 200 },
      );
    };

    const result = await replyWithOpenAI({
      customerName,
      profile,
      history,
      text: "ABC123",
      apiKey: "test-key",
      model: "gpt-6-luna",
      fetchImpl,
    });

    expect(requestedUrl).toBe("https://api.openai.com/v1/chat/completions");
    expect(new Headers(requestInit?.headers).get("authorization")).toBe("Bearer test-key");
    const body = JSON.parse(String(requestInit?.body));
    expect(body.model).toBe("gpt-6-luna");
    expect(body.response_format.json_schema).toEqual({
      name: "business_agent_reply",
      strict: true,
      schema: {
        type: "object",
        properties: {
          reply: { type: "string" },
          status: {
            type: "string",
            enum: ["needs_detail", "answered", "escalated"],
          },
        },
        required: ["reply", "status"],
        additionalProperties: false,
      },
    });
    expect(body.temperature).toBeUndefined();
    expect(requestInit?.signal).toBeInstanceOf(AbortSignal);
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[0].content).toContain(customerName);
    expect(body.messages[0].content).toContain(profile.detailHint);
    expect(body.messages[0].content).toContain(profile.facts);
    expect(body.messages.slice(1)).toEqual([
      { role: "user", content: "Is my Friday flight delayed?" },
      { role: "assistant", content: "What's your confirmation code?" },
      { role: "user", content: "ABC123" },
    ]);
    expect(result).toEqual({
      text: "Flight SK 482 is delayed.",
      flow: { awaitingDetail: true },
    });
  });

  it("maps answered and escalated statuses to flow state", async () => {
    const answered = await replyWithOpenAI({
      customerName,
      profile,
      history: [],
      text: "ABC123",
      apiKey: "test-key",
      model: "gpt-6-luna",
      fetchImpl: completionFetch("Your flight is delayed.", "answered"),
    });
    const escalated = await replyWithOpenAI({
      customerName,
      profile,
      history: [],
      text: "Please get me a human.",
      apiKey: "test-key",
      model: "gpt-6-luna",
      fetchImpl: completionFetch("A human will follow up.", "escalated"),
    });

    expect(answered.flow).toEqual({ awaitingDetail: false, escalated: false });
    expect(escalated.flow).toEqual({ awaitingDetail: false, escalated: true });
  });

  it("throws on unsuccessful HTTP responses and malformed content", async () => {
    await expect(
      replyWithOpenAI({
        customerName,
        profile,
        history: [],
        text: "Hello",
        apiKey: "test-key",
        model: "gpt-6-luna",
        fetchImpl: async () => new Response("unavailable", { status: 500 }),
      }),
    ).rejects.toThrow("OpenAI business agent request failed with HTTP 500");
    await expect(
      replyWithOpenAI({
        customerName,
        profile,
        history: [],
        text: "Hello",
        apiKey: "test-key",
        model: "gpt-6-luna",
        fetchImpl: async () =>
          new Response(JSON.stringify({ choices: [{ message: { content: "not JSON" } }] }), {
            status: 200,
          }),
      }),
    ).rejects.toThrow("OpenAI business agent response content is not valid JSON");
  });

  it("rejects invalid response shapes and blank replies", async () => {
    await expect(
      replyWithOpenAI({
        customerName,
        profile,
        history: [],
        text: "Hello",
        apiKey: "test-key",
        model: "gpt-6-luna",
        fetchImpl: completionFetch("   ", "answered"),
      }),
    ).rejects.toThrow("OpenAI business agent response has a blank reply");
    await expect(
      replyWithOpenAI({
        customerName,
        profile,
        history: [],
        text: "Hello",
        apiKey: "test-key",
        model: "gpt-6-luna",
        fetchImpl: completionFetch("Anything", "unknown"),
      }),
    ).rejects.toThrow("OpenAI business agent response has an invalid shape");
  });
});

describe("runAgentTurn", () => {
  it("falls back to the deterministic follow-up when OpenAI fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const turn = await runAgentTurn({
      customerName,
      initialText: "Is my Friday flight on time?",
      previousFlow: {},
      history: [],
      openai: {
        apiKey: "test-key",
        model: "gpt-6-luna",
        fetchImpl: async () => {
          throw new Error("offline");
        },
      },
    });

    expect(turn).toEqual({
      text: "I can check that. What's your confirmation code?",
      flow: { awaitingDetail: true },
    });
    expect(console.warn).toHaveBeenCalledWith(
      "OpenAI business agent reply failed; using deterministic response",
    );
  });

  it("does not call OpenAI after the conversation is escalated", async () => {
    let called = false;
    const turn = await runAgentTurn({
      customerName,
      initialText: "Thanks.",
      previousFlow: { escalated: true },
      history: [],
      openai: {
        apiKey: "test-key",
        model: "gpt-6-luna",
        fetchImpl: async () => {
          called = true;
          throw new Error("should not be called");
        },
      },
    });

    expect(called).toBe(false);
    expect(turn).toEqual({
      text: "A human will follow up via Skyline Airways's normal support channel.",
      flow: { escalated: true, awaitingDetail: false },
    });
  });
});

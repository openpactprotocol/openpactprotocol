import { describe, expect, it } from "vitest";
import type { BusinessThread } from "./conversationStore.js";
import { runPersonalAgent } from "./paAgent.js";
import { DEMO_USER_PROFILE } from "./userProfile.js";

const businesses = [
  {
    customerId: "skyline-id",
    name: "Skyline Airways",
    description: "Flight status and trip changes.",
    skills: [{ name: "Flight status", description: "Check flight times." }],
  },
  {
    customerId: "loom-id",
    name: "Loom & Co.",
    description: "Order tracking and delivery changes.",
    skills: [{ name: "Order status", description: "Track and redirect orders." }],
  },
  {
    customerId: "bloom-id",
    name: "Bloom & Stem",
    description: "Flower orders and delivery.",
    skills: [{ name: "Flower orders", description: "Check flower delivery." }],
  },
];

function toolCall(id: string, customerId: string, message: string) {
  return {
    id,
    type: "function",
    function: {
      name: "contact_support_a2a",
      arguments: JSON.stringify({ customerId, message }),
    },
  };
}

function completion(body: { content?: string | null; toolCalls?: unknown[] }) {
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content: body.content ?? null,
            ...(body.toolCalls ? { tool_calls: body.toolCalls } : {}),
          },
        },
      ],
    }),
    { status: 200 },
  );
}

const commonInput = {
  text: "Will my flight delay affect the dress delivery?",
  transcript: [
    { role: "user" as const, text: "Earlier question." },
    { role: "personal-agent" as const, text: "Earlier reply." },
  ],
  threads: [] as BusinessThread[],
  businesses,
  profile: DEMO_USER_PROFILE,
  apiKey: "test-key",
  model: "gpt-6-luna",
  onUpdate: () => {},
};

describe("runPersonalAgent", () => {
  it("contacts businesses sequentially, streams an update, and preserves tool messages", async () => {
    const requestBodies: Record<string, unknown>[] = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requestBodies.push(body);
      if (requestBodies.length === 1) {
        return completion({ toolCalls: [toolCall("skyline-call", "skyline-id", "Check SK 482.")] });
      }
      if (requestBodies.length === 2) {
        return completion({
          content: "I found an update.",
          toolCalls: [toolCall("loom-call", "loom-id", "Check the Saturday hotel redirect.")],
        });
      }
      return completion({ content: "Your flight is delayed, and I checked the delivery option." });
    };
    const calls: { customerId: string; message: string }[] = [];
    const updates: string[] = [];

    const result = await runPersonalAgent({
      ...commonInput,
      sendToBusiness: async (customerId, message) => {
        calls.push({ customerId, message });
        return customerId === "skyline-id"
          ? "The flight is delayed."
          : "The hotel redirect is free.";
      },
      onUpdate: (text) => updates.push(text),
      fetchImpl,
    });

    expect(calls).toEqual([
      { customerId: "skyline-id", message: "Check SK 482." },
      { customerId: "loom-id", message: "Check the Saturday hotel redirect." },
    ]);
    expect(updates).toEqual(["I found an update."]);
    expect(result).toBe("Your flight is delayed, and I checked the delivery option.");

    const firstBody = requestBodies[0]!;
    expect(firstBody.model).toBe("gpt-6-luna");
    expect(firstBody.reasoning_effort).toBe("none");
    expect(firstBody.parallel_tool_calls).toBe(true);
    expect(firstBody.tools).toEqual([
      {
        type: "function",
        function: {
          name: "contact_support_a2a",
          description: "Send a message to a business's support agent and get its reply.",
          strict: true,
          parameters: {
            type: "object",
            properties: {
              customerId: { type: "string", enum: ["skyline-id", "loom-id", "bloom-id"] },
              message: { type: "string" },
            },
            required: ["customerId", "message"],
            additionalProperties: false,
          },
        },
      },
    ]);
    const firstMessages = firstBody.messages as { role: string; content: string }[];
    expect(firstMessages[0]?.content).toContain("Skyline Airways");
    expect(firstMessages[0]?.content).toContain("Loom & Co.");
    expect(firstMessages[0]?.content).toContain(DEMO_USER_PROFILE.facts[0]);
    expect(firstMessages.map(({ role }) => role)).toEqual(["system", "user", "assistant", "user"]);
    expect(firstMessages.at(-1)?.content).toBe(commonInput.text);

    const secondMessages = requestBodies[1]!.messages as {
      role: string;
      content: string | null;
      tool_calls?: { id: string }[];
      tool_call_id?: string;
    }[];
    expect(secondMessages.at(-2)).toMatchObject({
      role: "assistant",
      tool_calls: [{ id: "skyline-call" }],
    });
    expect(secondMessages.at(-1)).toEqual({
      role: "tool",
      tool_call_id: "skyline-call",
      content: "The flight is delayed.",
    });
  });

  it("runs parallel calls in one step before requesting another completion", async () => {
    const requestBodies: Record<string, unknown>[] = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return requestBodies.length === 1
        ? completion({
            toolCalls: [
              toolCall("skyline-call", "skyline-id", "Check the flight."),
              toolCall("bloom-call", "bloom-id", "Check the flowers."),
            ],
          })
        : completion({ content: "Both checks are complete." });
    };
    let release: (() => void) | undefined;
    const bothStarted = new Promise<void>((resolve) => {
      release = resolve;
    });
    const calls: string[] = [];

    const result = await runPersonalAgent({
      ...commonInput,
      sendToBusiness: async (customerId) => {
        calls.push(customerId);
        if (calls.length === 2) release?.();
        await bothStarted;
        return `${customerId} reply`;
      },
      fetchImpl,
    });

    expect(result).toBe("Both checks are complete.");
    expect(calls).toEqual(["skyline-id", "bloom-id"]);
    expect(requestBodies).toHaveLength(2);
  });

  it("turns a failed business send into a tool message and continues", async () => {
    const requestBodies: Record<string, unknown>[] = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return requestBodies.length === 1
        ? completion({ toolCalls: [toolCall("bloom-call", "bloom-id", "Check delivery.")] })
        : completion({ content: "I couldn't reach the florist." });
    };

    const result = await runPersonalAgent({
      ...commonInput,
      sendToBusiness: async () => {
        throw new Error("offline");
      },
      fetchImpl,
    });

    expect(result).toBe("I couldn't reach the florist.");
    const messages = requestBodies[1]!.messages as {
      role: string;
      content: string | null;
      tool_call_id?: string;
    }[];
    expect(messages.at(-1)).toEqual({
      role: "tool",
      tool_call_id: "bloom-call",
      content: "Couldn't reach Bloom & Stem: offline",
    });
  });

  it("disables tools on the request after six tool steps", async () => {
    const requestBodies: Record<string, unknown>[] = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      if (requestBodies.length <= 6) {
        return completion({
          toolCalls: [toolCall(`call-${requestBodies.length}`, "skyline-id", "Check again.")],
        });
      }
      return completion({ content: "The final update." });
    };

    const result = await runPersonalAgent({
      ...commonInput,
      sendToBusiness: async () => "No new details.",
      fetchImpl,
    });

    expect(result).toBe("The final update.");
    expect(requestBodies).toHaveLength(7);
    expect(requestBodies.at(-1)?.tool_choice).toBe("none");
  });

  it("throws on HTTP errors", async () => {
    await expect(
      runPersonalAgent({
        ...commonInput,
        sendToBusiness: async () => "reply",
        fetchImpl: async () => new Response("unavailable", { status: 503 }),
      }),
    ).rejects.toThrow("OpenAI personal agent request failed with HTTP 503");
  });

  it("throws when a final response has missing or blank content", async () => {
    for (const response of [completion({}), completion({ content: "  " })]) {
      await expect(
        runPersonalAgent({
          ...commonInput,
          sendToBusiness: async () => "reply",
          fetchImpl: async () => response,
        }),
      ).rejects.toThrow("OpenAI personal agent response has no final text");
    }
  });

  it("includes earlier business threads in the system prompt", async () => {
    let systemPrompt = "";
    const thread: BusinessThread = {
      customerId: "skyline-id",
      businessName: "Skyline Airways",
      contextId: "context-id",
      messages: [
        { role: "ROLE_USER", text: "Check SK 482.", at: "2026-01-01T00:00:00.000Z" },
        { role: "ROLE_AGENT", text: "What is your code?", at: "2026-01-01T00:00:01.000Z" },
      ],
      awaitingReply: true,
    };
    const fetchImpl: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as {
        messages: { role: string; content: string | null }[];
      };
      systemPrompt = body.messages[0]?.content ?? "";
      return completion({ content: "I need your code." });
    };

    await runPersonalAgent({
      ...commonInput,
      threads: [thread],
      sendToBusiness: async () => "reply",
      fetchImpl,
    });

    expect(systemPrompt).toContain("Your earlier messages with businesses in this conversation:");
    expect(systemPrompt).toContain("  You: Check SK 482.");
    expect(systemPrompt).toContain("  Skyline Airways: What is your code?");
  });

  it("converts invalid arguments and unknown customers into tool replies", async () => {
    const requestBodies: Record<string, unknown>[] = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return requestBodies.length === 1
        ? completion({
            toolCalls: [
              {
                id: "bad-json",
                type: "function",
                function: { name: "contact_support_a2a", arguments: "{" },
              },
              toolCall("unknown", "not-known", "Hello."),
            ],
          })
        : completion({ content: "I wasn't able to check." });
    };
    const sendToBusiness = async (): Promise<string> => {
      throw new Error("must not send an invalid call");
    };

    await runPersonalAgent({ ...commonInput, sendToBusiness, fetchImpl });
    const toolMessages = requestBodies[1]!.messages as {
      role: string;
      tool_call_id?: string;
      content: string | null;
    }[];
    expect(toolMessages.slice(-2)).toEqual([
      {
        role: "tool",
        tool_call_id: "bad-json",
        content: "Invalid arguments for contact_support_a2a.",
      },
      {
        role: "tool",
        tool_call_id: "unknown",
        content: "Unknown business customerId: not-known",
      },
    ]);
  });
});

import { describe, expect, it } from "vitest";
import { composeWithOpenAI } from "./llmComposer.js";

describe("composeWithOpenAI", () => {
  it("sends the strict schema, transcript, and business outcomes and trims the reply", async () => {
    let requestedUrl = "";
    let requestInit: RequestInit | undefined;
    const fetchImpl: typeof fetch = async (input, init) => {
      requestedUrl = String(input);
      requestInit = init;
      return new Response(
        JSON.stringify({
          choices: [
            { message: { content: JSON.stringify({ reply: "  Skyline needs your code.  " }) } },
          ],
        }),
        { status: 200 },
      );
    };

    const reply = await composeWithOpenAI({
      text: "What about my flight?",
      transcript: [
        { role: "user", text: "Hello" },
        { role: "personal-agent", text: "How can I help?" },
      ],
      replies: [
        {
          businessName: "Skyline Airways",
          reply: "What's your confirmation code?",
          waitingOnUser: true,
        },
      ],
      unreachable: ["Loom & Co."],
      apiKey: "test-key",
      model: "gpt-6-luna",
      fetchImpl,
    });

    expect(reply).toBe("Skyline needs your code.");
    expect(requestedUrl).toBe("https://api.openai.com/v1/chat/completions");
    expect(new Headers(requestInit?.headers).get("authorization")).toBe("Bearer test-key");
    const body = JSON.parse(String(requestInit?.body));
    expect(body.model).toBe("gpt-6-luna");
    expect(body.response_format).toEqual({
      type: "json_schema",
      json_schema: {
        name: "compose_reply",
        strict: true,
        schema: {
          type: "object",
          properties: { reply: { type: "string" } },
          required: ["reply"],
          additionalProperties: false,
        },
      },
    });
    expect(body.messages).toEqual([
      {
        role: "system",
        content:
          "You are the user's personal agent, texting them on their phone. You forwarded their latest message to the businesses below, and each business's own support agent replied to you. Write your next text to the user in the first person, as their agent, not as the businesses. Relay the concrete facts the businesses gave. If a business needs something from the user (such as a booking code or order number), ask for it and say which business needs it. If a business couldn't be reached, say so briefly. Use only facts from the replies and the conversation; never invent details. Don't mention A2A, PAC2, protocols or context IDs. Plain text, no markdown, at most three short sentences.",
      },
      { role: "user", content: "Hello" },
      { role: "assistant", content: "How can I help?" },
      {
        role: "user",
        content: JSON.stringify({
          message: "What about my flight?",
          replies: [
            {
              business: "Skyline Airways",
              reply: "What's your confirmation code?",
              waitingOnUser: true,
            },
          ],
          unreachable: ["Loom & Co."],
        }),
      },
    ]);
    expect(requestInit?.signal).toBeInstanceOf(AbortSignal);
  });

  it("throws on unsuccessful HTTP responses", async () => {
    const fetchImpl: typeof fetch = async () => new Response("unavailable", { status: 500 });
    await expect(
      composeWithOpenAI({
        text: "hello",
        transcript: [],
        replies: [],
        unreachable: [],
        apiKey: "test-key",
        model: "gpt-6-luna",
        fetchImpl,
      }),
    ).rejects.toThrow("OpenAI composition failed with HTTP 500");
  });

  it("throws on malformed content and blank replies", async () => {
    for (const content of ["not JSON", JSON.stringify({ reply: "  " })]) {
      const fetchImpl: typeof fetch = async () =>
        new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
      await expect(
        composeWithOpenAI({
          text: "hello",
          transcript: [],
          replies: [],
          unreachable: [],
          apiKey: "test-key",
          model: "gpt-6-luna",
          fetchImpl,
        }),
      ).rejects.toThrow();
    }
  });
});

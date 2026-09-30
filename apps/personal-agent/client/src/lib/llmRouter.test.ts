import { describe, expect, it } from "vitest";
import { routeWithOpenAI } from "./llmRouter.js";

const businesses = [
  {
    customerId: "skyline",
    name: "Skyline Airways",
    keywords: ["flight"],
    description: "Flight support.",
    skills: [{ name: "Flight status", description: "Check a flight." }],
  },
  {
    customerId: "loom",
    name: "Loom & Co.",
    keywords: ["dress"],
    description: "Order support.",
    skills: [{ name: "Order status", description: "Track an order." }],
  },
];

describe("routeWithOpenAI", () => {
  it("sends the strict route schema and filters and orders returned customer IDs", async () => {
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
                content: JSON.stringify({ customerIds: ["loom", "unknown", "skyline", "loom"] }),
              },
            },
          ],
        }),
        { status: 200 },
      );
    };

    const routes = await routeWithOpenAI({
      text: "Is my flight on time, and can my dress arrive Saturday?",
      businesses,
      awaiting: [{ customerId: "loom", question: "What's the order number?" }],
      apiKey: "test-key",
      model: "gpt-6-luna",
      fetchImpl,
    });

    expect(routes).toEqual(["skyline", "loom"]);
    expect(requestedUrl).toBe("https://api.openai.com/v1/chat/completions");
    expect(new Headers(requestInit?.headers).get("authorization")).toBe("Bearer test-key");
    const body = JSON.parse(String(requestInit?.body));
    expect(body.model).toBe("gpt-6-luna");
    expect(body.response_format.json_schema).toEqual({
      name: "route",
      strict: true,
      schema: {
        type: "object",
        properties: {
          customerIds: {
            type: "array",
            items: { type: "string", enum: ["skyline", "loom"] },
          },
        },
        required: ["customerIds"],
        additionalProperties: false,
      },
    });
    expect(body.messages[0].content).toBe(
      "You are a personal agent's router. Given the user's message, the businesses you can reach, and any questions businesses are waiting on, return the customerIds of every business that should receive the message verbatim. Pick all businesses the message is about. If the message only answers a pending question, pick just that business. Always pick at least one.",
    );
    expect(JSON.parse(body.messages[1].content)).toEqual({
      message: "Is my flight on time, and can my dress arrive Saturday?",
      businesses: [
        {
          customerId: "skyline",
          name: "Skyline Airways",
          description: "Flight support.",
          skills: [{ name: "Flight status", description: "Check a flight." }],
        },
        {
          customerId: "loom",
          name: "Loom & Co.",
          description: "Order support.",
          skills: [{ name: "Order status", description: "Track an order." }],
        },
      ],
      pendingQuestions: [
        {
          customerId: "loom",
          businessName: "Loom & Co.",
          question: "What's the order number?",
        },
      ],
    });
  });

  it("throws on non-successful OpenAI responses", async () => {
    const fetchImpl: typeof fetch = async () => new Response("unavailable", { status: 500 });
    await expect(
      routeWithOpenAI({
        text: "hello",
        businesses,
        awaiting: [],
        apiKey: "test-key",
        model: "gpt-6-luna",
        fetchImpl,
      }),
    ).rejects.toThrow("OpenAI routing failed with HTTP 500");
  });

  it("throws when the response selects no known businesses", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ customerIds: ["unknown"] }) } }],
        }),
        { status: 200 },
      );
    await expect(
      routeWithOpenAI({
        text: "hello",
        businesses,
        awaiting: [],
        apiKey: "test-key",
        model: "gpt-6-luna",
        fetchImpl,
      }),
    ).rejects.toThrow("OpenAI routing returned no known businesses");
  });
});

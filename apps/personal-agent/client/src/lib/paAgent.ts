import type { BusinessThread } from "./conversationStore.js";

type Business = {
  customerId: string;
  name: string;
  description: string;
  skills: { name: string; description: string }[];
};

type Profile = {
  name: string;
  facts: string[];
};

type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
};

type AssistantMessage = { content: string | null; toolCalls: ToolCall[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readToolCall(value: unknown): ToolCall {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    value.type !== "function" ||
    !isRecord(value.function) ||
    typeof value.function.name !== "string" ||
    typeof value.function.arguments !== "string"
  ) {
    throw new Error("OpenAI personal agent response has an invalid tool call");
  }
  return {
    id: value.id,
    type: "function",
    function: { name: value.function.name, arguments: value.function.arguments },
  };
}

function readAssistantMessage(response: unknown): AssistantMessage {
  if (!isRecord(response) || !Array.isArray(response.choices)) {
    throw new Error("OpenAI personal agent response is missing choices");
  }
  const firstChoice = response.choices[0];
  if (!isRecord(firstChoice) || !isRecord(firstChoice.message)) {
    throw new Error("OpenAI personal agent response is missing an assistant message");
  }
  const message = firstChoice.message;
  if (
    message.content !== undefined &&
    message.content !== null &&
    typeof message.content !== "string"
  ) {
    throw new Error("OpenAI personal agent response has invalid content");
  }
  const toolCalls =
    message.tool_calls === undefined
      ? []
      : Array.isArray(message.tool_calls)
        ? message.tool_calls.map(readToolCall)
        : (() => {
            throw new Error("OpenAI personal agent response has invalid tool calls");
          })();
  return { content: typeof message.content === "string" ? message.content : null, toolCalls };
}

function buildSystemPrompt(input: {
  profile: Profile;
  businesses: Business[];
  threads: BusinessThread[];
}): string {
  const businessList = input.businesses
    .map(
      (business) =>
        `- ${business.name} (${business.customerId}): ${business.description} Skills: ${business.skills.map((skill) => `${skill.name}: ${skill.description}`).join("; ")}`,
    )
    .join("\n");
  const earlierMessages =
    input.threads
      .filter((thread) => thread.messages.length > 0)
      .map(
        (thread) =>
          `${thread.businessName}:\n${thread.messages
            .map(
              (message) =>
                `  ${message.role === "ROLE_USER" ? "You" : thread.businessName}: ${message.text}`,
            )
            .join("\n")}`,
      )
      .join("\n\n") || "None yet.";

  return [
    `You are ${input.profile.name}'s personal agent, texting with them on their phone. You can reach these businesses' own support agents with the contact_support_a2a tool:\n${businessList}`,
    `What you know about ${input.profile.name}:\n${input.profile.facts.map((fact) => `- ${fact}`).join("\n")}`,
    `Your earlier messages with businesses in this conversation:\n${earlierMessages}`,
    "How to work:",
    "- Decide which businesses the user's message concerns and contact only those.",
    `- Write each business its own short, self-contained message as ${input.profile.name}'s agent, including only the details that business needs from what you know. Don't share one business's details with another unless it's needed, such as a hotel address for a delivery change.`,
    "- When a business asks for something you know, answer it yourself with another contact_support_a2a call. Ask the user only for things you don't know or decisions only they can make.",
    "- Contact businesses at the same time when their questions are independent. When one answer affects what to ask another, such as a flight delay changing when a delivery should arrive, contact them one after the other.",
    "- While you still have businesses to contact, you may include a short text to the user alongside your tool calls.",
    "- When you're done, text the user in the first person. Relay concrete facts, say what you arranged, and ask for anything you still need. Use only facts from the businesses' replies, the conversation and what you know about the user; never invent details. Don't mention tools, A2A, PAC2, protocols or context IDs. Plain text, no markdown, at most three short sentences.",
  ].join("\n\n");
}

function readToolArguments(
  rawArguments: string,
): { customerId: string; message: string } | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawArguments);
  } catch {
    return undefined;
  }
  if (
    !isRecord(parsed) ||
    typeof parsed.customerId !== "string" ||
    typeof parsed.message !== "string" ||
    !parsed.message.trim()
  ) {
    return undefined;
  }
  return { customerId: parsed.customerId, message: parsed.message };
}

export async function runPersonalAgent(input: {
  text: string;
  transcript: { role: "user" | "personal-agent"; text: string }[];
  threads: BusinessThread[];
  businesses: Business[];
  profile: Profile;
  apiKey: string;
  model: string;
  sendToBusiness: (customerId: string, message: string) => Promise<string>;
  onUpdate: (text: string) => void;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const businessIds = input.businesses.map((business) => business.customerId);
  const messages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt(input) },
    ...input.transcript.map(
      ({ role, text }): ChatMessage => ({
        role: role === "user" ? "user" : "assistant",
        content: text,
      }),
    ),
    { role: "user", content: input.text },
  ];
  const tools = [
    {
      type: "function",
      function: {
        name: "contact_support_a2a",
        description: "Send a message to a business's support agent and get its reply.",
        strict: true,
        parameters: {
          type: "object",
          properties: {
            customerId: { type: "string", enum: businessIds },
            message: { type: "string" },
          },
          required: ["customerId", "message"],
          additionalProperties: false,
        },
      },
    },
  ];

  async function requestFinal(toolChoiceNone = false): Promise<AssistantMessage> {
    const response = await fetchImpl("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: input.model,
        reasoning_effort: "none",
        tools,
        parallel_tool_calls: true,
        messages,
        ...(toolChoiceNone ? { tool_choice: "none" } : {}),
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new Error(`OpenAI personal agent request failed with HTTP ${response.status}`);
    }
    return readAssistantMessage(await response.json());
  }

  async function executeToolCall(call: ToolCall): Promise<ChatMessage> {
    let content: string;
    if (call.function.name !== "contact_support_a2a") {
      content = `Unsupported tool: ${call.function.name}`;
    } else {
      const args = readToolArguments(call.function.arguments);
      if (!args) {
        content = "Invalid arguments for contact_support_a2a.";
      } else {
        const business = input.businesses.find(
          (candidate) => candidate.customerId === args.customerId,
        );
        if (!business) {
          content = `Unknown business customerId: ${args.customerId}`;
        } else {
          try {
            content = await input.sendToBusiness(args.customerId, args.message);
          } catch (cause) {
            const message = cause instanceof Error ? cause.message : "Request failed";
            content = `Couldn't reach ${business.name}: ${message}`;
          }
        }
      }
    }
    return { role: "tool", tool_call_id: call.id, content };
  }

  for (let step = 0; step < 6; step += 1) {
    const assistant = await requestFinal();
    if (assistant.toolCalls.length === 0) {
      const text = assistant.content?.trim() ?? "";
      if (!text) throw new Error("OpenAI personal agent response has no final text");
      return text;
    }

    if (assistant.content?.trim()) input.onUpdate(assistant.content.trim());
    messages.push({
      role: "assistant",
      content: assistant.content,
      tool_calls: assistant.toolCalls,
    });
    messages.push(...(await Promise.all(assistant.toolCalls.map(executeToolCall))));
  }

  const final = await requestFinal(true);
  const text = final.content?.trim() ?? "";
  if (!text) throw new Error("OpenAI personal agent response has no final text");
  return text;
}

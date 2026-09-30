import type { AgentTurn, BusinessProfile } from "./index.js";

type ReplyStatus = "needs_detail" | "answered" | "escalated";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isReplyStatus(value: unknown): value is ReplyStatus {
  return value === "needs_detail" || value === "answered" || value === "escalated";
}

function readCompletionContent(response: unknown): string {
  if (!isRecord(response) || !Array.isArray(response.choices)) {
    throw new Error("OpenAI business agent response is missing choices");
  }
  const firstChoice = response.choices[0];
  if (
    !isRecord(firstChoice) ||
    !isRecord(firstChoice.message) ||
    typeof firstChoice.message.content !== "string"
  ) {
    throw new Error("OpenAI business agent response is missing JSON content");
  }
  return firstChoice.message.content;
}

export async function replyWithOpenAI(input: {
  customerName: string;
  profile: BusinessProfile;
  history: { role: "customer" | "agent"; text: string }[];
  text: string;
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
}): Promise<AgentTurn> {
  const systemPrompt = [
    `You are the customer support agent for ${input.customerName} (${input.profile.description}). You are chatting with a customer's personal agent over A2A; it relays the customer's words verbatim. Reply in one or two short, friendly sentences of plain text with no markdown.`,
    `Only address the parts of the message that concern ${input.customerName}; ignore anything about other companies.`,
    `To look anything up you need ${input.profile.detailHint}. If the customer has not provided it yet in this conversation, briefly acknowledge what they asked and ask for it, ending your reply with that question.`,
    `Once they have provided it, treat it as their account and answer using only these facts: ${input.profile.facts} Do not invent other details, and do not end an answer with a question.`,
    `If the customer asks for a human, say a human will follow up through ${input.customerName}'s normal support channel.`,
    'Set status to "needs_detail" when you asked for that detail, "answered" when you answered, and "escalated" when you handed off to a human.',
  ].join("\n");
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: input.model,
      response_format: {
        type: "json_schema",
        json_schema: {
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
        },
      },
      messages: [
        { role: "system", content: systemPrompt },
        ...input.history.map(({ role, text }) => ({
          role: role === "customer" ? "user" : "assistant",
          content: text,
        })),
        { role: "user", content: input.text },
      ],
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`OpenAI business agent request failed with HTTP ${response.status}`);
  }

  const completion: unknown = await response.json();
  const content = readCompletionContent(completion);
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("OpenAI business agent response content is not valid JSON");
  }
  if (!isRecord(parsed) || typeof parsed.reply !== "string" || !isReplyStatus(parsed.status)) {
    throw new Error("OpenAI business agent response has an invalid shape");
  }
  const reply = parsed.reply.trim();
  if (!reply) throw new Error("OpenAI business agent response has a blank reply");

  const flow: AgentTurn["flow"] = {
    needs_detail: { awaitingDetail: true },
    answered: { awaitingDetail: false, escalated: false },
    escalated: { awaitingDetail: false, escalated: true },
  }[parsed.status];
  return { text: reply, flow };
}

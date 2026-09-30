const SYSTEM_PROMPT =
  "You are the user's personal agent, texting them on their phone. You forwarded their latest message to the businesses below, and each business's own support agent replied to you. Write your next text to the user in the first person, as their agent, not as the businesses. Relay the concrete facts the businesses gave. If a business needs something from the user (such as a booking code or order number), ask for it and say which business needs it. If a business couldn't be reached, say so briefly. Use only facts from the replies and the conversation; never invent details. Don't mention A2A, PAC2, protocols or context IDs. Plain text, no markdown, at most three short sentences.";

type ComposerReply = {
  businessName: string;
  reply: string;
  waitingOnUser: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readCompletionContent(response: unknown): string {
  if (!isRecord(response) || !Array.isArray(response.choices)) {
    throw new Error("OpenAI composition response is missing choices");
  }
  const firstChoice = response.choices[0];
  if (
    !isRecord(firstChoice) ||
    !isRecord(firstChoice.message) ||
    typeof firstChoice.message.content !== "string"
  ) {
    throw new Error("OpenAI composition response is missing JSON content");
  }
  return firstChoice.message.content;
}

export async function composeWithOpenAI(input: {
  text: string;
  transcript: { role: "user" | "personal-agent"; text: string }[];
  replies: ComposerReply[];
  unreachable: string[];
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
}): Promise<string> {
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
          name: "compose_reply",
          strict: true,
          schema: {
            type: "object",
            properties: { reply: { type: "string" } },
            required: ["reply"],
            additionalProperties: false,
          },
        },
      },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...input.transcript.map(({ role, text }) => ({
          role: role === "user" ? "user" : "assistant",
          content: text,
        })),
        {
          role: "user",
          content: JSON.stringify({
            message: input.text,
            replies: input.replies.map(({ businessName, reply, waitingOnUser }) => ({
              business: businessName,
              reply,
              waitingOnUser,
            })),
            unreachable: input.unreachable,
          }),
        },
      ],
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`OpenAI composition failed with HTTP ${response.status}`);
  }

  const content = readCompletionContent(await response.json());
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("OpenAI composition response content is not valid JSON");
  }
  if (!isRecord(parsed) || typeof parsed.reply !== "string" || !parsed.reply.trim()) {
    throw new Error("OpenAI composition response is missing a non-blank reply");
  }
  return parsed.reply.trim();
}

import type { RoutableBusiness } from "./router.js";

const ROUTER_SYSTEM_PROMPT =
  "You are a personal agent's router. Given the user's message, the businesses you can reach, and any questions businesses are waiting on, return the customerIds of every business that should receive the message verbatim. Pick all businesses the message is about. If the message only answers a pending question, pick just that business. Always pick at least one.";

type LlmBusiness = RoutableBusiness & {
  description: string;
  skills: { name: string; description: string }[];
};

type PendingQuestion = { customerId: string; question: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readCompletionContent(response: unknown): string {
  if (!isRecord(response) || !Array.isArray(response.choices)) {
    throw new Error("OpenAI routing response is missing choices");
  }
  const firstChoice = response.choices[0];
  if (
    !isRecord(firstChoice) ||
    !isRecord(firstChoice.message) ||
    typeof firstChoice.message.content !== "string"
  ) {
    throw new Error("OpenAI routing response is missing JSON content");
  }
  return firstChoice.message.content;
}

export async function routeWithOpenAI(input: {
  text: string;
  businesses: LlmBusiness[];
  awaiting: PendingQuestion[];
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
}): Promise<string[]> {
  if (input.businesses.length === 0) {
    throw new Error("OpenAI routing requires at least one business");
  }

  const businessIds = [...new Set(input.businesses.map((business) => business.customerId))];
  const businessesById = new Map(
    input.businesses.map((business) => [business.customerId, business]),
  );
  const pendingQuestions = input.awaiting.flatMap((pending) => {
    const business = businessesById.get(pending.customerId);
    return business
      ? [
          {
            customerId: pending.customerId,
            businessName: business.name,
            question: pending.question,
          },
        ]
      : [];
  });
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: input.model,
      temperature: 0,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "route",
          strict: true,
          schema: {
            type: "object",
            properties: {
              customerIds: {
                type: "array",
                items: { type: "string", enum: businessIds },
              },
            },
            required: ["customerIds"],
            additionalProperties: false,
          },
        },
      },
      messages: [
        { role: "system", content: ROUTER_SYSTEM_PROMPT },
        {
          role: "user",
          content: JSON.stringify({
            message: input.text,
            businesses: input.businesses.map(({ customerId, name, description, skills }) => ({
              customerId,
              name,
              description,
              skills,
            })),
            pendingQuestions,
          }),
        },
      ],
    }),
  });
  if (!response.ok) {
    throw new Error(`OpenAI routing failed with HTTP ${response.status}`);
  }

  const completion: unknown = await response.json();
  const content = readCompletionContent(completion);
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("OpenAI routing response content is not valid JSON");
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.customerIds)) {
    throw new Error("OpenAI routing response is missing customerIds");
  }

  const selectedIds = new Set(
    parsed.customerIds.filter(
      (customerId): customerId is string =>
        typeof customerId === "string" && businessIds.includes(customerId),
    ),
  );
  const routes = [
    ...new Set(
      input.businesses
        .filter((business) => selectedIds.has(business.customerId))
        .map((business) => business.customerId),
    ),
  ];
  if (routes.length === 0) {
    throw new Error("OpenAI routing returned no known businesses");
  }
  return routes;
}

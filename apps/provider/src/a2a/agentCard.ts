import { AgentCardSchema, type AgentCard } from "@pac2/protocol";
import type { customers } from "../db/schema.js";

export function buildAgentCard(
  customer: typeof customers.$inferSelect,
  baseUrl: string,
): AgentCard {
  const base = baseUrl.replace(/\/+$/, "");
  return AgentCardSchema.parse({
    name: `${customer.name} Support`,
    description: `A2A support agent for ${customer.name}.`,
    supportedInterfaces: [
      {
        url: `${base}/a2a/${customer.id}`,
        protocolBinding: "HTTP+JSON",
        protocolVersion: "1.0",
      },
    ],
    provider: { organization: "Decagon (PAC2 test harness)", url: base },
    version: "0.1.0",
    capabilities: { streaming: false, pushNotifications: false, extendedAgentCard: false },
    securitySchemes: {
      platformJwt: {
        httpAuthSecurityScheme: {
          scheme: "Bearer",
          bearerFormat: "JWT",
          description:
            "JWT signed by a registered Personal Agent platform; aud is the platform's registered audience (default {base}/a2a)",
        },
      },
    },
    securityRequirements: [{ schemes: { platformJwt: { list: [] } } }],
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    skills: [
      {
        id: "faq",
        name: "FAQ",
        description: "Answer questions about hours, location, parking, and insurance.",
        tags: ["faq"],
      },
    ],
  });
}

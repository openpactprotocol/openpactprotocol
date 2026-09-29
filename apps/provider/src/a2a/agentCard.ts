import { AgentCardSchema, type AgentCard } from "@pap/protocol";
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
        url: `${base}/a2a/${customer.slug}`,
        protocolBinding: "JSONRPC",
        protocolVersion: "1.0",
      },
    ],
    provider: { organization: "Decagon (PAP test harness)", url: base },
    version: "0.1.0",
    capabilities: { streaming: false, pushNotifications: false, extendedAgentCard: false },
    securitySchemes: {
      paPlatformJwt: {
        httpAuthSecurityScheme: {
          scheme: "Bearer",
          bearerFormat: "JWT",
          description:
            "ES256 platform JWT verified against the platform's registered JWKS; aud must equal the interface url",
        },
      },
    },
    securityRequirements: [{ schemes: { paPlatformJwt: { list: [] } } }],
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

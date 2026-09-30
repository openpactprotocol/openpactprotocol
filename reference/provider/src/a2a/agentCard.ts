import { AgentCardSchema, type AgentCard } from "@pac2/protocol";
import { businessProfile } from "../agent/index.js";
import type { customers } from "../db/schema.js";

export function buildAgentCard(
  customer: typeof customers.$inferSelect,
  baseUrl: string,
): AgentCard {
  const base = baseUrl.replace(/\/+$/, "");
  const profile = businessProfile(customer.name);
  return AgentCardSchema.parse({
    name: customer.name,
    description: profile.description,
    supportedInterfaces: [
      {
        url: `${base}/a2a/${customer.id}`,
        protocolBinding: "HTTP+JSON",
        protocolVersion: "1.0",
      },
    ],
    provider: { organization: "PAC2 reference provider", url: base },
    version: "0.1.0",
    capabilities: { streaming: false, pushNotifications: false, extendedAgentCard: false },
    securitySchemes: {
      platformJwt: {
        httpAuthSecurityScheme: {
          scheme: "Bearer",
          bearerFormat: "JWT",
          description:
            "JWT signed by a registered Personal Agent platform; aud is the audience assigned by the provider at registration",
        },
      },
    },
    securityRequirements: [{ schemes: { platformJwt: { list: [] } } }],
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    skills: [profile.skill],
  });
}

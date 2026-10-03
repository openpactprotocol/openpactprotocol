import { AgentCardSchema, type AgentCard } from "@openpactprotocol/protocol";
import { businessProfile } from "../agent/index.js";
import type { customers } from "../db/schema.js";
import { delegationConfig, delegationUrls } from "../delegation/config.js";

export function buildAgentCard(
  customer: typeof customers.$inferSelect,
  baseUrl: string,
): AgentCard {
  const base = baseUrl.replace(/\/+$/, "");
  const profile = businessProfile(customer.name);
  const delegation = delegationConfig(customer.name);
  const urls = delegationUrls(base, customer.id);
  return AgentCardSchema.parse({
    name: customer.name,
    description: profile.description,
    supportedInterfaces: [
      {
        url: urls.interfaceUrl,
        protocolBinding: "HTTP+JSON",
        protocolVersion: "1.0",
      },
    ],
    provider: { organization: "PACT reference provider", url: base },
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
      ...(delegation
        ? {
            userDelegation: {
              oauth2SecurityScheme: {
                description: `Act on the User's ${customer.name} account within the scopes they approve`,
                flows: {
                  deviceCode: {
                    deviceAuthorizationUrl: urls.deviceAuthorization,
                    tokenUrl: urls.token,
                    scopes: Object.fromEntries(
                      delegation.scopes.map((scope) => [scope.id, scope.description]),
                    ),
                  },
                },
                oauth2MetadataUrl: urls.metadata,
              },
            },
          }
        : {}),
    },
    securityRequirements: [
      { schemes: { platformJwt: { list: [] } } },
      ...(delegation
        ? [{ schemes: { platformJwt: { list: [] }, userDelegation: { list: [] } } }]
        : []),
    ],
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    skills: [profile.skill],
  });
}

import { AgentCardSchema, type AgentCard } from "@pap/protocol";
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { aops, customers } from "../db/schema.js";

export async function buildAgentCard(
  db: Db,
  customer: typeof customers.$inferSelect,
  baseUrl: string,
): Promise<AgentCard> {
  const visibleAops = await db
    .select()
    .from(aops)
    .where(and(eq(aops.customerId, customer.id), sql`${aops.channels} @> ARRAY['a2a']::text[]`));
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
    skills: visibleAops.map((aop) => ({
      id: aop.id,
      name: aop.name,
      description: aop.description,
      tags: aop.tags,
      examples: aop.examples,
    })),
  });
}

import { AgentCardSchema } from "@pap/protocol";
import { and, eq, sql } from "drizzle-orm";
import { aops, customers } from "../../../../db/schema.js";
import { getDb } from "../../../../db/client.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function baseUrl(request: Request): string {
  return (
    process.env.PROVIDER_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : new URL(request.url).origin)
  ).replace(/\/+$/, "");
}

export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await context.params;
  const [customer] = await getDb()
    .select()
    .from(customers)
    .where(and(eq(customers.slug, slug), eq(customers.a2aEnabled, true)))
    .limit(1);
  if (!customer) return Response.json({ error: "Not found" }, { status: 404 });
  const visibleAops = await getDb()
    .select()
    .from(aops)
    .where(and(eq(aops.customerId, customer.id), sql`${aops.channels} @> ARRAY['a2a']::text[]`));
  const base = baseUrl(request);
  const card = AgentCardSchema.parse({
    name: `${customer.name} Support`,
    description: `A2A support agent for ${customer.name}.`,
    supportedInterfaces: [
      { url: `${base}/a2a/${slug}`, protocolBinding: "JSONRPC", protocolVersion: "1.0" },
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
  return Response.json(card, {
    headers: { "Cache-Control": "public, max-age=60", "Access-Control-Allow-Origin": "*" },
  });
}

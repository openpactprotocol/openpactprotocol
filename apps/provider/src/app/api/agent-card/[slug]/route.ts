import { getDb } from "../../../../db/client.js";
import { buildAgentCard } from "../../../../a2a/agentCard.js";
import { getProviderBaseUrl } from "../../../../a2a/providerBaseUrl.js";
import { and, eq } from "drizzle-orm";
import { customers } from "../../../../db/schema.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  const card = await buildAgentCard(getDb(), customer, getProviderBaseUrl(request));
  return Response.json(card, {
    headers: { "Cache-Control": "public, max-age=60", "Access-Control-Allow-Origin": "*" },
  });
}

import { createA2AHandler } from "../../../a2a/handler.js";
import { getDb } from "../../../db/client.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await context.params;
  return createA2AHandler({ db: getDb() })(request, slug);
}

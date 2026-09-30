import { createA2AHandler } from "../../../../a2a/handler.js";
import { getDb } from "../../../../db/client.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ customerId: string; path?: string[] }>;
};

async function handle(request: Request, context: RouteContext): Promise<Response> {
  const { customerId, path } = await context.params;
  return createA2AHandler({ db: getDb() })(request, customerId, path ?? []);
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
export const PUT = handle;
export const PATCH = handle;
export const OPTIONS = handle;
export const HEAD = handle;

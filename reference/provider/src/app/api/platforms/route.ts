import { createRegisterPlatformHandler } from "../../../platforms/register.js";
import { getDb } from "../../../db/client.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return createRegisterPlatformHandler({ db: getDb() })(request);
}

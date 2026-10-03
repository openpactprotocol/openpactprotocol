import { cookies } from "next/headers";
import { pollAuthorization } from "../../../../lib/delegation.js";
import { USER_ID_COOKIE } from "../../../../lib/session.js";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const body: unknown = await request.json().catch(() => undefined);
  const authorizationId =
    typeof body === "object" && body !== null && "authorizationId" in body
      ? body.authorizationId
      : undefined;
  if (typeof authorizationId !== "string") {
    return Response.json({ error: "Invalid poll request" }, { status: 400 });
  }
  const userId = (await cookies()).get(USER_ID_COOKIE)?.value;
  if (!userId) return Response.json({ error: "Missing user ID" }, { status: 400 });
  const issuer = process.env.PA_ISSUER;
  const privateJwk = process.env.PA_PRIVATE_JWK;
  const audience = process.env.PA_AUDIENCE;
  if (!issuer || !privateJwk || !audience) {
    return Response.json({ error: "PA signing credentials are not configured" }, { status: 500 });
  }
  try {
    return Response.json(
      await pollAuthorization(authorizationId, { userId, issuer, privateJwk, audience }),
    );
  } catch (cause) {
    return Response.json(
      { error: cause instanceof Error ? cause.message : "Poll failed" },
      { status: 502 },
    );
  }
}

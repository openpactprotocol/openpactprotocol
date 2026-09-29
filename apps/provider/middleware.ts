import { NextResponse, type NextRequest } from "next/server";

function constantTimeEqual(left: string, right: string): boolean {
  const maxLength = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < maxLength; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

export function middleware(request: NextRequest): NextResponse {
  const user = process.env.ADMIN_USER;
  const password = process.env.ADMIN_PASSWORD;
  if (!user || !password)
    return new NextResponse("Admin credentials are not configured", { status: 503 });
  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Basic ")) {
    try {
      const [suppliedUser, ...passwordParts] = atob(authorization.slice(6)).split(":");
      const suppliedPassword = passwordParts.join(":");
      if (
        constantTimeEqual(suppliedUser ?? "", user) &&
        constantTimeEqual(suppliedPassword, password)
      ) {
        return NextResponse.next();
      }
    } catch {
      return new NextResponse("Unauthorized", {
        status: 401,
        headers: { "WWW-Authenticate": 'Basic realm="PAP admin"' },
      });
    }
  }
  return new NextResponse("Unauthorized", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="PAP admin"' },
  });
}

export const config = { matcher: ["/admin", "/admin/:path*"] };

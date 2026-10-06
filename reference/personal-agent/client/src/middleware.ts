import { NextResponse, type NextRequest } from "next/server";
import { USER_ID_COOKIE, USER_ID_COOKIE_OPTIONS } from "./lib/session.js";

export function middleware(request: NextRequest): NextResponse {
  if (request.cookies.has(USER_ID_COOKIE)) return NextResponse.next();
  const userId = crypto.randomUUID();
  request.cookies.set(USER_ID_COOKIE, userId);
  const response = NextResponse.next({ request: { headers: request.headers } });
  response.cookies.set(USER_ID_COOKIE, userId, USER_ID_COOKIE_OPTIONS);
  return response;
}

export const config = { matcher: "/" };

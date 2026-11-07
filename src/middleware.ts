import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/server/better-auth";

/**
 * Sends signed-out visitors to /login and passes on Better Auth's cookie renewals (at most once a
 * day for the session, every few minutes for the cookie cache). Runs on Node, so it can read the
 * session from Postgres when the cookie cache is stale.
 */
export async function middleware(request: NextRequest) {
  const found = await auth.api
    .getSession({ headers: request.headers, returnHeaders: true })
    .catch((e) => {
      console.error("Session check failed", e);
      return null;
    });

  if (!found?.response) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  const response = NextResponse.next({ request });
  for (const cookie of found.headers.getSetCookie()) response.headers.append("Set-Cookie", cookie);
  return response;
}

export const config = {
  runtime: "nodejs",
  matcher: [
    "/((?!login|forgot-password|_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};

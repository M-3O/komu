import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE_NAME } from "@/lib/auth/session";

/**
 * Sends signed-out visitors to the login page.
 *
 * This is a convenience, not the security boundary. It only checks that a
 * well-formed session cookie is present, because Proxy also runs while
 * prerendering and must not do cryptographic work there. Every protected
 * page and Server Action separately calls `requireCurrentUser`, which fully
 * verifies the signature and expiry.
 *
 * The docs also warn that Server Functions are not separate routes, so a
 * matcher change could silently drop Proxy coverage. That is exactly why the
 * real check lives in the pages rather than here.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isDashboard = pathname.startsWith("/dashboard");
  const isSetup = pathname === "/setup";

  if (!isDashboard && !isSetup) return NextResponse.next();

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;

  if (looksLikeSessionToken(token)) return NextResponse.next();

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("returnTo", pathname);

  return NextResponse.redirect(loginUrl);
}

/** Cheap shape check: a signed token is `base64url.signature`. */
function looksLikeSessionToken(token: string | undefined): boolean {
  if (!token) return false;

  const separator = token.indexOf(".");
  return separator > 0 && separator < token.length - 1;
}

export const config = {
  matcher: ["/dashboard/:path*", "/setup"],
};
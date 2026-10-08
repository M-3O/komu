import { redirect } from "next/navigation";

import { destroySession } from "@/lib/auth/session";

/**
 * Sign out.
 *
 * POST only, so another site cannot force a visitor to log out by sending
 * them to a URL.
 *
 * POST /logout
 */
export async function POST(request: Request) {
  await destroySession();
  redirect(new URL("/", request.url).toString());
}
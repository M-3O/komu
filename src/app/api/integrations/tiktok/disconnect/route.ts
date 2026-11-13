import { NextResponse } from "next/server";

import { requireCurrentUser } from "@/lib/auth/current-user";
import { requireGuild } from "@/lib/dashboard/require-guild";
import {
  getTikTokIntegrationStatus,
  getTikTokOAuthConfig,
  getTrustedApplicationOrigin,
} from "@/lib/tiktok/config";
import {
  disconnectTikTokConnection,
} from "@/lib/tiktok/connection-store";

/** Disconnect is a same-origin, owner-authorized POST. */
export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginRequest(request)) return safeErrorResponse("forbidden", 403);

  let status;
  try {
    status = getTikTokIntegrationStatus();
  } catch {
    return safeErrorResponse("not_available", 503);
  }
  if (!status.enabled) return safeErrorResponse("not_available", 503);

  const config = getTikTokOAuthConfig();
  if (!config) return safeErrorResponse("not_available", 503);

  await requireCurrentUser("/dashboard/streams");
  const guild = await requireGuild("/dashboard/streams");
  const form = await request.formData();
  const connectionId = String(form.get("connectionId") ?? "");

  if (!connectionId || connectionId.length > 128) {
    return redirectWithResult("disconnect_failed");
  }

  let result;
  try {
    result = await disconnectTikTokConnection({
      guildId: guild.id,
      connectionId,
      config,
    });
  } catch {
    return redirectWithResult("disconnect_failed");
  }

  if (result.ok) return redirectWithResult("disconnected");

  // Do not claim that TikTok revoked the credential when the provider call
  // failed. The connection store retains a bounded, encrypted retry record.
  return redirectWithResult(
    result.error === "not_connected"
      ? "disconnect_failed"
      : result.error === "operation_in_progress"
        ? "disconnect_in_progress"
        : "revocation_pending",
  );
}

function isSameOriginRequest(request: Request): boolean {
  const trustedOrigin = getTrustedApplicationOrigin();
  return Boolean(trustedOrigin && request.headers.get("origin") === trustedOrigin);
}

function redirectWithResult(result: string): NextResponse {
  const trustedOrigin = getTrustedApplicationOrigin();
  if (!trustedOrigin) return safeErrorResponse("not_available", 503);

  const destination = new URL("/dashboard/streams", trustedOrigin);
  destination.searchParams.set("tiktok", result);
  return NextResponse.redirect(destination);
}

function safeErrorResponse(error: string, status: number): NextResponse {
  return NextResponse.json(
    { error },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

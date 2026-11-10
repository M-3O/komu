import { Link2, ShieldCheck, Unplug } from "lucide-react";
import {
  Badge,
  Panel,
  StatusMessage,
} from "@/components/dashboard/ui";
import { getTikTokIntegrationStatus } from "@/lib/tiktok/config";
import type { TikTokConnectionView } from "@/lib/tiktok/connection-store";

/**
 * TikTok is shown separately from live-stream providers. The control is
 * disabled until the official app approval and the reviewed persistence
 * migration are both ready; it must never imply LIVE support.
 */
export function TikTokConnectionCard({
  connection,
}: {
  connection: TikTokConnectionView | null;
}) {
  let enabled = false;
  try {
    enabled = getTikTokIntegrationStatus().enabled;
  } catch {
    enabled = false;
  }

  return (
    <Panel
      title="TikTok account linking"
      description="Connect an account through TikTok Login Kit for approved profile and optional video features. TikTok LIVE alerts are not available."
      icon={ShieldCheck}
      action={<Badge tone={enabled ? "success" : "warning"}>{enabled ? "Ready" : "Unavailable"}</Badge>}
    >
      <div className="flex flex-col gap-4">
        <div className="rounded-xl border border-[color:var(--color-komu-border)] bg-white/[0.015] p-3 text-xs leading-5 text-[color:var(--color-komu-muted)]">
          <p>
            KOMU requests only <code className="text-[color:var(--color-komu-text)]">user.info.basic</code> for the initial link. The optional <code className="text-[color:var(--color-komu-text)]">video.list</code> scope is reserved for a separate opt-in feature.
          </p>
          <p className="mt-2 inline-flex items-start gap-2 text-[10px] leading-4 text-amber-200/80">
            <Link2 className="mt-0.5 h-3 w-3 shrink-0" />
            Account linking is independent from the existing Twitch, YouTube,
            and Kick live-status pipelines.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {enabled ? (
            <form action="/api/integrations/tiktok/connect" method="post">
              <button type="submit" className="komu-btn komu-btn-primary">
                <Link2 className="h-4 w-4" />
                {connection ? "Reconnect TikTok" : "Connect TikTok"}
              </button>
            </form>
          ) : (
            <button type="button" disabled className="komu-btn komu-btn-primary opacity-60">
              <Link2 className="h-4 w-4" />
              Connect TikTok
            </button>
          )}

          {enabled && connection ? (
            <form action="/api/integrations/tiktok/disconnect" method="post">
              <input type="hidden" name="connectionId" value={connection.id} />
              <button
                type="submit"
                className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[color:var(--color-komu-border)] px-3 text-xs text-[color:var(--color-komu-text)]"
              >
                <Unplug className="h-4 w-4" />
                Disconnect TikTok
              </button>
            </form>
          ) : (
            <button
              type="button"
              disabled
              title="Available after TikTok approval and the reviewed migration"
              className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[color:var(--color-komu-border)] px-3 text-xs text-[color:var(--color-komu-dim)] opacity-60"
            >
              <Unplug className="h-4 w-4" />
              Disconnect TikTok
            </button>
          )}
        </div>

        {connection ? (
          <div className="rounded-xl border border-[color:var(--color-komu-border)] bg-white/[0.015] p-3 text-xs leading-5 text-[color:var(--color-komu-muted)]">
            <p className="font-medium text-[color:var(--color-komu-text)]">
              {connection.displayName ?? "TikTok account linked"}
            </p>
            <p className="mt-1">Granted: {connection.grantedScopes.join(", ") || "none"}</p>
            {connection.reauthorizationRequiredAt ? (
              <p className="mt-1 text-amber-200/90">TikTok authorization needs to be renewed.</p>
            ) : null}
          </div>
        ) : null}

        {!enabled ? (
          <StatusMessage tone="info">
            Disabled until TikTok developer approval, server credentials, a
            static HTTPS callback, and the reviewed connection-storage
            migration are available.
          </StatusMessage>
        ) : null}
      </div>
    </Panel>
  );
}

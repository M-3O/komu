"use client";

import {
  AlertTriangle,
  CalendarClock,
  Eye,
  Link2,
  Plus,
  Radio,
  Unplug,
} from "lucide-react";
import { useActionState } from "react";

import {
  Badge,
  EmptyState,
  FormField,
  Panel,
  PlatformTile,
  ProviderBadge,
  StatusDot,
  StatusMessage,
  cn,
  formatDateTime,
  providerLabel,
} from "@/components/dashboard/ui";
import { connectChannelAction, disconnectChannelAction } from "./actions";

interface ChannelStream {
  title: string | null;
  game: string | null;
  thumbnail: string | null;
  viewerCount: number | null;
  url: string;
  startedAt: string | null;
}

interface ChannelStatus {
  id: string;
  provider: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  stream: ChannelStream | null;
  error?: string;
}

interface ChannelFormState {
  ok?: boolean;
  error?: string;
  /** The channel that was just connected, so the confirmation can name it. */
  connected?: string;
}

const INITIAL_STATE: ChannelFormState = {};

const PROVIDER_HINTS: Record<string, string> = {
  TWITCH: "Twitch login name or channel URL.",
  YOUTUBE: "YouTube channel ID, @handle, or channel URL. Uses API quota on each check.",
  KICK: "The exact slug after kick.com/ — hyphens are part of the name.",
};

/**
 * Connect a streaming channel, show its current live state, and disconnect one
 * that is no longer wanted.
 *
 * A Client Component because submitting either form needs `useActionState` to
 * show the provider's response.
 */
export function ChannelManager({
  statuses,
  availableProviders,
  alertRoutes,
}: {
  statuses: ChannelStatus[];
  availableProviders: string[];
  alertRoutes: string[];
}) {
  const [state, formAction, pending] = useActionState<
    ChannelFormState,
    FormData
  >(
    async (
      _previous: ChannelFormState,
      formData: FormData,
    ): Promise<ChannelFormState> => {
      const provider = String(formData.get("provider") ?? "");
      const identifier = String(formData.get("identifier") ?? "").trim();

      const result = await connectChannelAction(provider, identifier);

      return result.ok
        ? { ok: true, connected: identifier }
        : { ok: false, error: result.error ?? "Could not connect." };
    },
    INITIAL_STATE,
  );

  const [disconnectState, disconnectAction, disconnectPending] =
    useActionState<ChannelFormState, FormData>(
      async (
        _previous: ChannelFormState,
        formData: FormData,
      ): Promise<ChannelFormState> => {
        const id = String(formData.get("streamingAccountId") ?? "");
        const result = await disconnectChannelAction(id);

        return result.ok
          ? { ok: true }
          : { ok: false, error: result.error ?? "Could not disconnect." };
      },
      INITIAL_STATE,
    );

  const liveCount = statuses.filter((status) => status.stream).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-display text-base font-semibold text-[color:var(--color-komu-text)]">
            Live connections
          </h2>
          <p className="mt-0.5 text-xs text-[color:var(--color-komu-muted)]">
            {statuses.length === 0
              ? "No accounts connected yet."
              : `${liveCount} live now · ${statuses.length} total ${statuses.length === 1 ? "pipeline" : "pipelines"}`}
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 text-[11px] text-[color:var(--color-komu-muted)]">
          <StatusDot tone={liveCount > 0 ? "success" : "neutral"} pulse={liveCount > 0} />
          Provider status checked now
        </span>
      </div>

      {statuses.length === 0 ? (
        <EmptyState
          icon={Radio}
          title="No streaming accounts connected"
          description="Add a Twitch, YouTube, or Kick account below. Komu will check it for live broadcasts on the configured interval."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {statuses.map((status) => {
            const live = Boolean(status.stream);
            const routed = alertRoutes.includes(status.id);

            return (
              <article
                key={status.id}
                className={cn(
                  "komu-card overflow-hidden",
                  live && "border-emerald-400/25 shadow-[0_0_30px_-18px_rgba(16,185,129,.45)]",
                )}
              >
                <div className="relative h-32 overflow-hidden border-b border-[color:var(--color-komu-border)] bg-[#0d1521]">
                  {status.stream?.thumbnail ? (
                    // Provider thumbnails are public CDN images.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={status.stream.thumbnail}
                      alt=""
                      className="h-full w-full object-cover opacity-40"
                    />
                  ) : (
                    <div className="komu-grid-lines absolute inset-0 opacity-60" />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-[#0b0f17] via-[#0b0f17]/35 to-transparent" />

                  <div className="absolute left-3 top-3">
                    <PlatformTile provider={status.provider} />
                  </div>
                  <div className="absolute right-3 top-3">
                    <Badge tone={live ? "success" : status.error ? "danger" : "neutral"} dot={live}>
                      {live ? "Live" : status.error ? "Unknown" : "Offline"}
                    </Badge>
                  </div>

                  <div className="absolute bottom-3 left-3 right-3 min-w-0">
                    <p className="truncate font-display text-sm font-semibold text-white">
                      {status.displayName ?? status.username}
                    </p>
                    <p className="truncate text-[10px] text-slate-300/80">
                      {providerLabel(status.provider)} · @{status.username}
                    </p>
                  </div>
                </div>

                <div className="p-4">
                  {live && status.stream ? (
                    <div className="min-h-[58px]">
                      <p className="line-clamp-2 text-sm font-medium leading-5 text-[color:var(--color-komu-text)]">
                        {status.stream.title ?? "Untitled stream"}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[color:var(--color-komu-muted)]">
                        {status.stream.game ? (
                          <span className="inline-flex items-center gap-1">
                            <Radio className="h-3 w-3 text-emerald-400" />
                            {status.stream.game}
                          </span>
                        ) : null}
                        {status.stream.viewerCount !== null ? (
                          <span className="inline-flex items-center gap-1">
                            <Eye className="h-3 w-3" />
                            {status.stream.viewerCount.toLocaleString()} watching
                          </span>
                        ) : null}
                        {status.stream.startedAt ? (
                          <span className="inline-flex items-center gap-1">
                            <CalendarClock className="h-3 w-3" />
                            {formatDateTime(status.stream.startedAt)}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  ) : (
                    <div className="flex min-h-[58px] flex-col justify-center">
                      <p className="text-xs leading-5 text-[color:var(--color-komu-muted)]">
                        {status.error ??
                          "Standing by. Komu will announce the next live broadcast."}
                      </p>
                      {status.error ? (
                        <p className="mt-1 inline-flex items-center gap-1 text-[10px] text-amber-300/80">
                          <AlertTriangle className="h-3 w-3" />
                          Provider did not answer; no status is being guessed.
                        </p>
                      ) : null}
                    </div>
                  )}

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[color:var(--color-komu-border)] pt-3">
                    <div className="flex items-center gap-2">
                      <ProviderBadge provider={status.provider} />
                      <Badge tone={routed ? "success" : "warning"}>
                        {routed ? "Alert armed" : "No route"}
                      </Badge>
                    </div>

                    <div className="flex items-center gap-2">
                      {live && status.stream ? (
                        <a
                          href={status.stream.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="komu-btn komu-btn-secondary min-h-8 px-2.5 py-1 text-[11px]"
                        >
                          Watch
                        </a>
                      ) : null}

                      <form action={disconnectAction}>
                        <input
                          type="hidden"
                          name="streamingAccountId"
                          value={status.id}
                        />
                        <button
                          type="submit"
                          disabled={disconnectPending}
                          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-[color:var(--color-komu-dim)] transition hover:bg-red-500/10 hover:text-red-300 disabled:opacity-60"
                        >
                          <Unplug className="h-3 w-3" />
                          {disconnectPending ? "Removing…" : "Disconnect"}
                        </button>
                      </form>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <Panel
        title="Connection pipeline"
        description="Add a creator account so Komu can watch for live broadcasts."
        icon={Link2}
        action={<Badge tone="accent">{availableProviders.length} providers ready</Badge>}
      >
        {availableProviders.length === 0 ? (
          <StatusMessage tone="error">
            No streaming provider is configured. Add provider credentials to the
            environment before connecting an account.
          </StatusMessage>
        ) : (
          <form action={formAction} className="flex flex-col gap-3">
            <div className="grid gap-3 md:grid-cols-[180px_minmax(0,1fr)_auto] md:items-end">
              <FormField label="Platform">
                <select
                  name="provider"
                  defaultValue={availableProviders[0] ?? ""}
                  className="komu-input"
                >
                  {availableProviders.map((provider) => (
                    <option key={provider} value={provider}>
                      {providerLabel(provider)}
                    </option>
                  ))}
                </select>
              </FormField>

              <FormField
                label="Channel"
                hint="Twitch login, YouTube channel ID or @handle, or Kick slug."
              >
                <input
                  name="identifier"
                  required
                  placeholder="name, channel id or profile URL"
                  className="komu-input"
                />
              </FormField>

              <button
                type="submit"
                disabled={pending}
                className="komu-btn komu-btn-primary md:mb-[22px]"
              >
                <Plus className="h-4 w-4" />
                {pending ? "Connecting…" : "Connect"}
              </button>
            </div>

            <div className="grid gap-1.5 rounded-xl border border-[color:var(--color-komu-border)] bg-white/[0.015] p-3 sm:grid-cols-3">
              {availableProviders.map((provider) => (
                <p
                  key={provider}
                  className="text-[10px] leading-4 text-[color:var(--color-komu-muted)]"
                >
                  <span className="font-semibold text-[color:var(--color-komu-text)]">
                    {providerLabel(provider)}:
                  </span>{" "}
                  {PROVIDER_HINTS[provider] ?? "Use the account identifier."}
                </p>
              ))}
            </div>

            {state?.error ? (
              <StatusMessage tone="error">{state.error}</StatusMessage>
            ) : null}

            {state?.ok ? (
              <StatusMessage tone="success">
                {state.connected} is connected. The next polling cycle will pick
                it up.
              </StatusMessage>
            ) : null}

            {disconnectState?.error ? (
              <StatusMessage tone="error">{disconnectState.error}</StatusMessage>
            ) : null}

            {disconnectState?.ok ? (
              <StatusMessage tone="success">
                The channel was disconnected.
              </StatusMessage>
            ) : null}
          </form>
        )}
      </Panel>
    </div>
  );
}

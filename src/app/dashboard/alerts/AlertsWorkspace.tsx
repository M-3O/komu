"use client";

import { Eye, Radio, Route } from "lucide-react";
import Image from "next/image";
import { useState } from "react";

import {
  Badge,
  Panel,
  PlatformTile,
  ProviderBadge,
  StatusDot,
  cn,
  providerLabel,
} from "@/components/dashboard/ui";
import { AlertForm } from "./AlertForm";
import type { AlertAccount, ChannelOption } from "./types";

/**
 * Account switcher and preview around the alert form.
 *
 * Only the selected creator's form is mounted, which keeps a three-channel
 * installation from stacking three full configuration screens on one page.
 */
export function AlertsWorkspace({
  accounts,
  channels,
  roles,
}: {
  accounts: AlertAccount[];
  channels: ChannelOption[];
  roles: ChannelOption[];
}) {
  const [selectedId, setSelectedId] = useState(accounts[0]?.id ?? "");
  const selected = accounts.find((account) => account.id === selectedId) ?? accounts[0];

  if (!selected) return null;

  const channelLabel =
    channels.find((channel) => channel.id === selected.defaults.channelId)?.label ??
    "No Discord channel selected";
  const roleLabel =
    roles.find((role) => role.id === selected.defaults.mentionRoleId)?.label ?? null;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
        {accounts.map((account) => {
          const active = account.id === selected.id;
          const routed = account.defaults.enabled && Boolean(account.defaults.channelId);

          return (
            <button
              key={account.id}
              type="button"
              onClick={() => setSelectedId(account.id)}
              aria-pressed={active}
              className={cn(
                "flex items-center gap-3 rounded-xl border p-3 text-left transition",
                active
                  ? "border-indigo-400/45 bg-indigo-500/[0.075] shadow-[0_0_24px_-18px_rgba(99,102,241,.85)]"
                  : "border-[color:var(--color-komu-border)] bg-white/[0.012] hover:border-[color:var(--color-komu-border-muted)] hover:bg-white/[0.025]",
              )}
            >
              <PlatformTile provider={account.provider} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-semibold text-[color:var(--color-komu-text)]">
                    {account.displayName ?? account.username}
                  </span>
                  <StatusDot tone={routed ? "success" : "neutral"} pulse={routed} />
                </span>
                <span className="mt-0.5 block truncate text-[10px] text-[color:var(--color-komu-muted)]">
                  {providerLabel(account.provider)} · @{account.username}
                </span>
              </span>
              <Badge tone={routed ? "success" : "warning"}>
                {routed ? "Armed" : "Idle"}
              </Badge>
            </button>
          );
        })}
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <AlertForm
          // Remount when switching creators. The form is uncontrolled, so
          // without a new identity its defaultValue inputs and local toggles
          // would keep the previous creator's settings and could save them
          // onto the next account.
          key={selected.id}
          streamingAccountId={selected.id}
          channels={channels}
          roles={roles}
          defaults={selected.defaults}
        />

        <div className="xl:sticky xl:top-24">
          <Panel
            title="Dispatch preview"
            description="Saved settings, rendered as Discord sees them."
            icon={Eye}
          >
            <div className="rounded-xl bg-[#313338] p-3.5 text-[#dbdee1] shadow-inner">
              <div className="flex items-center gap-2.5">
                <span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-[#050505] ring-1 ring-white/10">
                  <Image
                    src="/brand/komu-avatar.webp"
                    alt=""
                    width={80}
                    height={80}
                    sizes="40px"
                    className="h-full w-full object-cover"
                  />
                </span>
                <div>
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-white">
                    Komu
                    <span className="rounded bg-[#5865f2] px-1 py-0.5 text-[8px] font-bold uppercase text-white">
                      App
                    </span>
                  </p>
                  <p className="text-[10px] text-[#949ba4]">Live alert preview</p>
                </div>
              </div>

              {selected.defaults.mentionEnabled && roleLabel ? (
                <p className="mt-2 text-xs font-medium text-indigo-300">
                  {roleLabel}
                </p>
              ) : null}

              <div
                className={cn(
                  "mt-2 border-l-[3px] pl-3",
                  selected.defaults.embedEnabled
                    ? "border-[color:var(--color-komu-accent)]"
                    : "border-transparent",
                )}
                style={
                  selected.defaults.embedEnabled
                    ? { borderColor: selected.defaults.embedColor }
                    : undefined
                }
              >
                <p className="text-xs leading-5">
                  {selected.defaults.messageMode === "CUSTOM" &&
                  selected.defaults.customMessage.trim()
                    ? selected.defaults.customMessage
                    : `${selected.displayName ?? selected.username} is live now.`}
                </p>

                {selected.defaults.embedEnabled ? (
                  <div className="mt-2 rounded-lg border border-white/5 bg-[#2b2d31] p-3">
                    <p className="font-display text-[9px] font-bold uppercase tracking-[0.1em] text-[#949ba4]">
                      Live on {providerLabel(selected.provider)}
                    </p>
                    <div className="mt-1.5 flex items-start gap-2.5">
                      {selected.defaults.showThumbnail ? (
                        <div className="flex h-14 w-24 shrink-0 items-center justify-center rounded border border-white/5 bg-gradient-to-br from-indigo-500/30 to-violet-600/20">
                          <Radio className="h-5 w-5 text-indigo-300" />
                        </div>
                      ) : null}
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-white">
                          Sample stream title
                        </p>
                        {selected.defaults.showGame ? (
                          <p className="mt-1 text-[10px] text-[#b5bac1]">Sample category</p>
                        ) : null}
                        {selected.defaults.showViewerCount ? (
                          <p className="mt-1 text-[10px] text-[#949ba4]">
                            1,234 watching
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ) : null}

                {selected.defaults.watchButtonEnabled ? (
                  <span className="mt-2 inline-flex rounded bg-[#4e5058] px-2.5 py-1.5 text-[10px] font-medium text-white">
                    {selected.defaults.watchButtonLabel || "Watch Now"}
                  </span>
                ) : null}
              </div>
            </div>

            <div className="mt-4 flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <span className="komu-label">Destination</span>
                <span className="text-[11px] text-[color:var(--color-komu-muted)]">
                  {channelLabel}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 border-t border-[color:var(--color-komu-border)] pt-3">
                <ProviderBadge provider={selected.provider} />
                <Badge
                  tone={
                    selected.defaults.enabled && selected.defaults.channelId
                      ? "success"
                      : "warning"
                  }
                >
                  {selected.defaults.enabled ? "Alerts on" : "Alerts off"}
                </Badge>
                <Badge tone="neutral">
                  <Route className="h-3 w-3" />
                  {selected.defaults.channelId ? "Routed" : "No route"}
                </Badge>
              </div>
              <p className="text-[10px] leading-4 text-[color:var(--color-komu-dim)]">
                The preview reflects saved settings. After saving, this card
                refreshes with the new presentation.
              </p>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

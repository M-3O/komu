import {
  Bell,
  Cable,
  Hash,
  MessageSquare,
  RefreshCw,
  Send,
} from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import {
  Badge,
  EmptyState,
  MetricCard,
  PageHeader,
  StatusMessage,
} from "@/components/dashboard/ui";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db";
import { listGuildChannels, listGuildRoles } from "@/lib/discord/rest";
import { AlertsWorkspace } from "./AlertsWorkspace";
import type { AlertAccount } from "./types";

export const metadata = { title: "Stream Alerts" };

/** Discord channel types Komu can post an alert into. */
const TEXT_CHANNEL_TYPES = new Set([0, 5, 10, 11, 12]);

/**
 * Stream alert configuration.
 *
 * Channel and role lists come from Discord over REST, so the creator sees
 * the real options rather than pasting an id.
 */
export default function AlertsPage() {
  return (
    <div className="flex flex-col gap-7">
      <PageHeader
        eyebrow="Broadcast automation"
        title="Stream alerts"
        description="Choose where live alerts are posted, how they look, and how members get from Discord to the stream."
        actions={
          <>
            <a href="/dashboard/alerts" className="komu-btn komu-btn-secondary">
              <RefreshCw className="h-4 w-4" />
              Refresh
            </a>
            <Link href="/dashboard/streams" className="komu-btn komu-btn-primary">
              <Cable className="h-4 w-4" />
              Manage channels
            </Link>
          </>
        }
      />

      <Suspense fallback={<AlertsSkeleton />}>
        <AlertSettingsPanel />
      </Suspense>
    </div>
  );
}

async function AlertSettingsPanel() {
  await requireCurrentUser("/dashboard/alerts");

  const guild = await prisma.guild.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, discordId: true },
  });

  if (!guild) {
    return (
      <EmptyState
        icon={Bell}
        title="Connect a Discord server first"
        description="Komu needs a server before it can route live alerts."
        action={
          <Link href="/setup" className="komu-btn komu-btn-primary">
            Open setup
          </Link>
        }
      />
    );
  }

  const accounts = await prisma.streamingAccount.findMany({
    where: { guildId: guild.id, disconnectedAt: null },
    select: {
      id: true,
      provider: true,
      username: true,
      displayName: true,
      alertConfig: true,
    },
    orderBy: { createdAt: "asc" },
  });

  if (accounts.length === 0) {
    return (
      <EmptyState
        icon={Cable}
        title="No streaming channels connected"
        description="Add a Twitch, YouTube, or Kick account before routing alerts."
        action={
          <Link href="/dashboard/streams" className="komu-btn komu-btn-primary">
            Connect a channel
          </Link>
        }
      />
    );
  }

  // Ask Discord once for the server's channels and roles.
  const [allChannels, allRoles] = await Promise.all([
    listGuildChannels(guild.discordId),
    listGuildRoles(guild.discordId),
  ]);

  const channels = allChannels
    .filter((channel) => TEXT_CHANNEL_TYPES.has(channel.type))
    .map((channel) => ({ id: channel.id, label: `#${channel.name}` }));

  const roles = allRoles
    // "@everyone" cannot be mentioned by a bot.
    .filter((role) => role.id !== guild.discordId)
    .map((role) => ({ id: role.id, label: `@${role.name}` }));

  const routed = accounts.filter(
    (account) => account.alertConfig?.enabled && account.alertConfig.channelId,
  ).length;
  const destinations = new Set(
    accounts
      .map((account) => account.alertConfig?.channelId)
      .filter((id): id is string => Boolean(id)),
  ).size;
  const mentions = accounts.filter(
    (account) => account.alertConfig?.mentionEnabled,
  ).length;

  const workspaceAccounts: AlertAccount[] = accounts.map((account) => {
    const config = account.alertConfig;

    return {
      id: account.id,
      provider: account.provider,
      username: account.username,
      displayName: account.displayName,
      defaults: {
        enabled: config?.enabled ?? true,
        channelId: config?.channelId ?? "",
        mentionRoleId: config?.mentionRoleId ?? "",
        mentionEnabled: config?.mentionEnabled ?? false,
        messageMode: config?.messageMode ?? "DEFAULT",
        customMessage: config?.customMessage ?? "",
        embedEnabled: config?.embedEnabled ?? true,
        embedColor: config?.embedColor ?? "#6366f1",
        showThumbnail: config?.showThumbnail ?? true,
        showViewerCount: config?.showViewerCount ?? true,
        showGame: config?.showGame ?? true,
        watchButtonEnabled: config?.watchButtonEnabled ?? true,
        watchButtonLabel: config?.watchButtonLabel ?? "Watch Now",
      },
    };
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Connected creators"
          value={accounts.length.toString()}
          hint="Each account has its own dispatch route"
          icon={Bell}
          tone="accent"
        />
        <MetricCard
          label="Alerts armed"
          value={routed.toString()}
          hint={`${accounts.length - routed} currently silent`}
          icon={Send}
          tone={routed === accounts.length ? "success" : "warning"}
        />
        <MetricCard
          label="Dispatch channels"
          value={destinations.toString()}
          hint="Unique Discord destinations"
          icon={Hash}
          tone="violet"
        />
        <MetricCard
          label="Role mentions"
          value={mentions.toString()}
          hint={mentions > 0 ? "Pings enabled on those routes" : "No pings configured"}
          icon={MessageSquare}
          tone="neutral"
        />
      </div>

      {channels.length === 0 ? (
        <div className="komu-card p-4">
          <StatusMessage tone="error">
            Komu could not read this server&apos;s text channels. Check that the
            bot is in the server and can see them, then refresh. No route can be
            saved until a destination is available.
          </StatusMessage>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Badge tone="warning">Discord permissions</Badge>
            <Link
              href="/dashboard/streams"
              className="text-xs font-medium text-indigo-300 hover:text-indigo-200"
            >
              Check connected channels
            </Link>
          </div>
        </div>
      ) : (
        <AlertsWorkspace
          accounts={workspaceAccounts}
          channels={channels}
          roles={roles}
        />
      )}
    </div>
  );
}

function AlertsSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-hidden>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <div
            key={index}
            className="h-32 animate-pulse rounded-2xl border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)]"
          />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <div className="h-[520px] animate-pulse rounded-2xl border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)]" />
        <div className="h-80 animate-pulse rounded-2xl border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)]" />
      </div>
    </div>
  );
}

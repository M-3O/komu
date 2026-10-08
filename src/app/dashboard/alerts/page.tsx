import { Suspense } from "react";

import { requireCurrentUser } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db";
import { listGuildChannels, listGuildRoles } from "@/lib/discord/rest";
import { AlertForm } from "./AlertForm";

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
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Stream Alerts</h1>
        <p className="text-sm text-[color:var(--color-komu-muted)]">
          Choose where live alerts are posted and how they look.
        </p>
      </header>

      <Suspense fallback={<PanelSkeleton />}>
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
      <p className="rounded-lg border border-[color:var(--color-komu-border)] p-4 text-sm text-[color:var(--color-komu-muted)]">
        Connect a Discord server first.
      </p>
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
      <p className="rounded-lg border border-[color:var(--color-komu-border)] p-4 text-sm text-[color:var(--color-komu-muted)]">
        No streaming channels connected yet. Add one on the Channels page.
      </p>
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

  return (
    <div className="flex flex-col gap-10">
      {accounts.map((account) => {
        const config = account.alertConfig;

        return (
          <section key={account.id} className="flex flex-col gap-4">
            <div>
              <h2 className="font-semibold">
                {account.displayName ?? account.username}
              </h2>
              <p className="text-sm text-[color:var(--color-komu-muted)]">
                {account.provider} · {account.username}
              </p>
            </div>

            {channels.length === 0 ? (
              <p className="rounded-md border border-[color:var(--color-komu-border)] p-3 text-sm text-[color:var(--color-komu-muted)]">
                Komu could not read this server&apos;s channels. Check that the
                bot is in the server and can see them, then reload.
              </p>
            ) : (
              <AlertForm
                streamingAccountId={account.id}
                channels={channels}
                roles={roles}
                defaults={{
                  enabled: config?.enabled ?? true,
                  channelId: config?.channelId ?? "",
                  mentionRoleId: config?.mentionRoleId ?? "",
                  mentionEnabled: config?.mentionEnabled ?? false,
                  messageMode: config?.messageMode ?? "DEFAULT",
                  customMessage: config?.customMessage ?? "",
                  embedEnabled: config?.embedEnabled ?? true,
                  embedColor: config?.embedColor ?? "#7c5cff",
                  showThumbnail: config?.showThumbnail ?? true,
                  showViewerCount: config?.showViewerCount ?? true,
                  showGame: config?.showGame ?? true,
                  watchButtonEnabled: config?.watchButtonEnabled ?? true,
                  watchButtonLabel: config?.watchButtonLabel ?? "Watch Now",
                }}
              />
            )}
          </section>
        );
      })}
    </div>
  );
}

function PanelSkeleton() {
  return (
    <div
      className="h-64 animate-pulse rounded-lg border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)]"
      aria-hidden
    />
  );
}
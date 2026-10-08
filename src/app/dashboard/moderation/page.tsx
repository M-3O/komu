import { Suspense } from "react";

import { requireCurrentUser } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db";
import { listGuildChannels } from "@/lib/discord/rest";
import {
  ACTIONS_FOR_TYPE,
  ACTION_LABELS,
  describeRuleConfig,
  RULE_TYPES,
  RULE_TYPE_LABELS,
} from "@/lib/moderation/rule-config";
import { ModerationManager } from "./ModerationManager";

export const metadata = { title: "Moderation" };

const MAX_LOG_ROWS = 25;

/**
 * Moderation rules and recent actions (PRD section 7.11).
 *
 * Rules are checked per message and per join, not on a schedule, so nothing
 * here needs a cron.
 */
export default function ModerationPage() {
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Moderation</h1>
        <p className="text-sm text-[color:var(--color-komu-muted)]">
          Filter messages, slow down spammers, and catch join raids
          automatically.
        </p>
      </header>

      <Suspense fallback={<PanelSkeleton />}>
        <ModerationPanel />
      </Suspense>
    </div>
  );
}

async function ModerationPanel() {
  await requireCurrentUser("/dashboard/moderation");

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

  const [rules, actions, channels] = await Promise.all([
    prisma.moderationRule.findMany({
      where: { guildId: guild.id },
      select: {
        id: true,
        name: true,
        enabled: true,
        type: true,
        action: true,
        actionDurationMins: true,
        blockedWords: true,
        warnOnMatch: true,
        messageLimit: true,
        windowSeconds: true,
        joinThreshold: true,
        joinWindowSeconds: true,
        logChannelId: true,
        _count: { select: { actions: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.moderationActionRecord.findMany({
      where: { guildId: guild.id },
      select: {
        id: true,
        type: true,
        reason: true,
        moderatorDiscordId: true,
        createdAt: true,
        targetMember: { select: { username: true, nickname: true } },
      },
      orderBy: { createdAt: "desc" },
      take: MAX_LOG_ROWS,
    }),
    listGuildChannels(guild.discordId),
  ]);

  const channelNames = new Map(channels.map((channel) => [channel.id, channel.name]));

  return (
    <div className="flex flex-col gap-6">
      <ModerationManager
        rules={rules.map((rule) => ({
          id: rule.id,
          name: rule.name,
          enabled: rule.enabled,
          summary: describeRuleConfig(rule),
          logChannel: rule.logChannelId
            ? (channelNames.get(rule.logChannelId) ?? "a deleted channel")
            : null,
          triggerCount: rule._count.actions,
        }))}
        channels={channels.map((channel) => ({
          id: channel.id,
          label: `#${channel.name}`,
        }))}
        types={RULE_TYPES.map((type) => ({
          value: type,
          label: RULE_TYPE_LABELS[type],
          actions: ACTIONS_FOR_TYPE[type].map((action) => ({
            value: action,
            label: ACTION_LABELS[action],
          })),
        }))}
        log={actions.map((action) => ({
          username: action.targetMember.nickname ?? action.targetMember.username,
          type: action.type,
          reason: action.reason,
          moderator: action.moderatorDiscordId,
          createdAt: action.createdAt.toISOString(),
        }))}
      />

      <p className="text-xs text-[color:var(--color-komu-muted)]">
        Rules are checked on every message and every join. Message rate and join
        spikes are counted in memory, so they reset when the bot restarts.
        Automod handles filtering, spam and raid protection; use{" "}
        <code className="text-[color:var(--color-komu-text)]">/warn</code>,{" "}
        <code className="text-[color:var(--color-komu-text)]">/timeout</code>,{" "}
        <code className="text-[color:var(--color-komu-text)]">/kick</code> and{" "}
        <code className="text-[color:var(--color-komu-text)]">/ban</code> for
        anything else.
      </p>
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
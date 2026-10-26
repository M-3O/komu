import { Activity, BarChart3, Clock, Filter, RefreshCw, Shield } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import {
  Badge,
  EmptyState,
  MetricCard,
  PageHeader,
  Panel,
} from "@/components/dashboard/ui";
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
    <div className="flex flex-col gap-7">
      <PageHeader
        eyebrow="Trust & safety"
        title="Moderation & safety"
        description="Filter messages, slow down spammers, and catch join raids automatically."
        actions={
          <>
            <Link href="/dashboard/analytics" className="komu-btn komu-btn-secondary">
              <BarChart3 className="h-4 w-4" />
              Analytics
            </Link>
            <a href="/dashboard/moderation" className="komu-btn komu-btn-primary">
              <RefreshCw className="h-4 w-4" />
              Refresh channels
            </a>
          </>
        }
      />

      <Suspense fallback={<ModerationSkeleton />}>
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
      <EmptyState
        icon={Shield}
        title="Connect a Discord server first"
        description="Moderation rules are scoped to the connected server."
        action={
          <Link href="/setup" className="komu-btn komu-btn-primary">
            Open setup
          </Link>
        }
      />
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
  const active = rules.filter((rule) => rule.enabled).length;
  const caught = rules.reduce((sum, rule) => sum + rule._count.actions, 0);
  const logging = rules.filter((rule) => rule.logChannelId).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Safety rules"
          value={rules.length.toString()}
          hint="Configured for this server"
          icon={Shield}
          tone="accent"
        />
        <MetricCard
          label="Active"
          value={active.toString()}
          hint={`${rules.length - active} paused`}
          icon={Shield}
          tone={active > 0 ? "success" : "neutral"}
        />
        <MetricCard
          label="Actions caught"
          value={caught.toLocaleString()}
          hint="Rule triggers recorded all time"
          icon={Activity}
          tone="violet"
        />
        <MetricCard
          label="Log destinations"
          value={logging.toString()}
          hint={logging > 0 ? "Rules writing to a channel" : "No rule is logging"}
          icon={Filter}
          tone={logging > 0 ? "success" : "warning"}
        />
      </div>

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

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="How rate limits behave"
          description="In-memory counters reset with the bot."
          icon={Clock}
          action={<Badge tone="warning">Runtime state</Badge>}
        >
          <p className="text-xs leading-5 text-[color:var(--color-komu-muted)]">
            Message rate and join spikes are counted in memory, so they reset
            when the bot restarts. The rules themselves are stored and resume
            immediately. A burst in progress at restart starts a fresh window.
          </p>
        </Panel>

        <Panel
          title="Manual moderation"
          description="For everything a rule should not automate."
          icon={Shield}
        >
          <p className="text-xs leading-5 text-[color:var(--color-komu-muted)]">
            Automod handles filtering, spam and raid protection. Use{" "}
            <code className="rounded border border-[color:var(--color-komu-border-muted)] bg-white/[0.03] px-1.5 py-0.5 text-[color:var(--color-komu-text)]">
              /warn
            </code>
            ,{" "}
            <code className="rounded border border-[color:var(--color-komu-border-muted)] bg-white/[0.03] px-1.5 py-0.5 text-[color:var(--color-komu-text)]">
              /timeout
            </code>
            ,{" "}
            <code className="rounded border border-[color:var(--color-komu-border-muted)] bg-white/[0.03] px-1.5 py-0.5 text-[color:var(--color-komu-text)]">
              /kick
            </code>{" "}
            and{" "}
            <code className="rounded border border-[color:var(--color-komu-border-muted)] bg-white/[0.03] px-1.5 py-0.5 text-[color:var(--color-komu-text)]">
              /ban
            </code>{" "}
            for anything else. Those actions appear in the log above.
          </p>
        </Panel>
      </div>
    </div>
  );
}

function ModerationSkeleton() {
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
      <div className="grid gap-4 xl:grid-cols-[1fr_430px]">
        <div className="h-96 animate-pulse rounded-2xl border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)]" />
        <div className="h-96 animate-pulse rounded-2xl border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)]" />
      </div>
    </div>
  );
}

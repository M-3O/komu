import {
  Clock,
  Gauge,
  MessageSquare,
  Shield,
  Trophy,
  Users,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import {
  Badge,
  MetricCard,
  PageHeader,
  Panel,
  StatusMessage,
} from "@/components/dashboard/ui";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db";
import { xpForLevel } from "@/lib/levels/calculate-level";
import { XpSettingsForm } from "./XpSettingsForm";

export const metadata = { title: "XP & Levels" };

/** The levels worth showing in the curve preview. */
const CURVE_PREVIEW_LEVELS = [2, 5, 10, 25, 50, 100];

/**
 * XP settings and the level curve (PRD section 7.5).
 *
 * The curve is shown because the XP settings only make sense next to it: a
 * creator choosing 15 XP per message needs to know that is level 5 in about
 * two hours of chatting, not level 50.
 */
export default function XpPage() {
  return (
    <div className="flex flex-col gap-7">
      <PageHeader
        eyebrow="Progression engine"
        title="XP, levels & community progress"
        description="Tune how much members earn for taking part, then see exactly what the anti-abuse rules allow."
        actions={
          <>
            <Link href="/dashboard/leaderboards" className="komu-btn komu-btn-secondary">
              <Trophy className="h-4 w-4" />
              Leaderboard
            </Link>
            <Link href="/dashboard/roles" className="komu-btn komu-btn-primary">
              <Shield className="h-4 w-4" />
              Level roles
            </Link>
          </>
        }
      />

      <Suspense fallback={<XpSkeleton />}>
        <XpPanel />
      </Suspense>
    </div>
  );
}

async function XpPanel() {
  await requireCurrentUser("/dashboard/xp");

  const guild = await prisma.guild.findFirstOrThrow({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      xpEnabled: true,
      xpMessageAmount: true,
      xpMessageMinLength: true,
      xpMessageCooldownSecs: true,
      xpDailyCap: true,
      _count: { select: { members: true } },
    },
  });

  const cooldown =
    guild.xpMessageCooldownSecs > 0
      ? `${Math.round((guild.xpMessageCooldownSecs / 60) * 10) / 10} min`
      : "Off";

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="XP per message"
          value={`${guild.xpMessageAmount.toLocaleString()} XP`}
          hint="For a qualifying message"
          icon={Zap}
          tone="accent"
        />
        <MetricCard
          label="Cooldown"
          value={cooldown}
          hint="Between XP-earning messages"
          icon={Clock}
          tone="violet"
        />
        <MetricCard
          label="Daily cap"
          value={
            guild.xpDailyCap > 0 ? guild.xpDailyCap.toLocaleString() : "No cap"
          }
          hint="Per member, from messages"
          icon={Gauge}
          tone={guild.xpDailyCap > 0 ? "warning" : "neutral"}
        />
        <MetricCard
          label="Members tracked"
          value={guild._count.members.toLocaleString()}
          hint="Profiles available for progression"
          icon={Users}
          tone="success"
        />
      </div>

      <XpSettingsForm
        settings={{
          xpEnabled: guild.xpEnabled,
          xpMessageAmount: guild.xpMessageAmount,
          xpMessageMinLength: guild.xpMessageMinLength,
          xpMessageCooldownSecs: guild.xpMessageCooldownSecs,
          xpDailyCap: guild.xpDailyCap,
        }}
      />

      <div className="grid gap-4 xl:grid-cols-12">
        <Panel
          className="xl:col-span-7"
          title="The level curve"
          description="Total XP needed to reach each milestone. The curve is the same for every server."
          icon={Trophy}
          action={<Badge tone="accent">6 milestones</Badge>}
        >
          <div className="overflow-x-auto">
            <table className="komu-table">
              <thead>
                <tr>
                  <th>Level</th>
                  <th>Total XP</th>
                  <th>Messages at current rate</th>
                  <th className="text-right">Tier</th>
                </tr>
              </thead>
              <tbody>
                {CURVE_PREVIEW_LEVELS.map((level, index) => (
                  <tr key={level}>
                    <td>
                      <span className="flex items-center gap-2 font-display text-sm font-semibold text-[color:var(--color-komu-text)]">
                        <span className="flex h-6 w-6 items-center justify-center rounded-md border border-indigo-400/20 bg-indigo-500/10 text-[10px] text-indigo-300">
                          {level}
                        </span>
                        Level {level}
                      </span>
                    </td>
                    <td className="font-medium">
                      {xpForLevel(level).toLocaleString()} XP
                    </td>
                    <td className="text-[color:var(--color-komu-muted)]">
                      {guild.xpMessageAmount > 0
                        ? Math.ceil(
                            xpForLevel(level) / guild.xpMessageAmount,
                          ).toLocaleString()
                        : "—"}
                    </td>
                    <td className="text-right">
                      <Badge tone={index < 2 ? "neutral" : index < 4 ? "accent" : "violet"}>
                        {index < 2 ? "Early" : index < 4 ? "Core" : "Prestige"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-[11px] leading-5 text-[color:var(--color-komu-muted)]">
            The message column is how many messages each level is worth at the
            current {guild.xpMessageAmount.toLocaleString()} XP rate, ignoring
            cooldowns and the daily cap.
          </p>
        </Panel>

        <Panel
          className="xl:col-span-5"
          title="Abuse prevention"
          description="The guardrails applied before XP is written."
          icon={Shield}
        >
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
            <GuardrailCard
              icon={MessageSquare}
              label="Minimum length"
              value={`${guild.xpMessageMinLength} characters`}
              detail="Shorter messages earn nothing."
            />
            <GuardrailCard
              icon={Clock}
              label="Cooldown"
              value={
                guild.xpMessageCooldownSecs > 0
                  ? `${Math.round((guild.xpMessageCooldownSecs / 60) * 10) / 10} minutes`
                  : "No wait"
              }
              detail="Time between XP-earning messages."
            />
            <GuardrailCard
              icon={Shield}
              label="Duplicate filter"
              value="2 repeats max"
              detail="Copy-paste spam stops earning XP."
            />
            <GuardrailCard
              icon={Gauge}
              label="Daily ceiling"
              value={
                guild.xpDailyCap > 0
                  ? `${guild.xpDailyCap.toLocaleString()} XP`
                  : "Unlimited"
              }
              detail="Rewards and challenges are not affected."
            />
          </div>

          {guild.xpEnabled ? null : (
            <div className="mt-4">
              <StatusMessage tone="error">
                XP for messages is switched off. Members do not currently earn
                XP for chatting, but attendance, rewards, challenges and
                achievements still pay out.
              </StatusMessage>
            </div>
          )}

          <p className="mt-4 border-t border-[color:var(--color-komu-border)] pt-3 text-[11px] leading-5 text-[color:var(--color-komu-muted)]">
            Switching XP off stops new awards but keeps existing XP and levels,
            so nobody loses progress.
          </p>
        </Panel>
      </div>
    </div>
  );
}

function GuardrailCard({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof Shield;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-xl border border-[color:var(--color-komu-border)] bg-white/[0.015] p-3">
      <div className="flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-indigo-300" />
        <p className="komu-label text-[9px]">{label}</p>
      </div>
      <p className="mt-1.5 font-display text-sm font-semibold text-[color:var(--color-komu-text)]">
        {value}
      </p>
      <p className="mt-0.5 text-[10px] leading-4 text-[color:var(--color-komu-dim)]">
        {detail}
      </p>
    </div>
  );
}

function XpSkeleton() {
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
      <div className="h-96 animate-pulse rounded-2xl border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)]" />
    </div>
  );
}

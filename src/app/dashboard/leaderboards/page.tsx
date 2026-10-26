import {
  Award,
  Crown,
  Medal,
  Sparkles,
  Trophy,
  TrendingUp,
} from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import {
  Badge,
  EmptyState,
  PageHeader,
  Panel,
  cn,
  initials,
} from "@/components/dashboard/ui";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db";
import { getLeaderboard } from "@/lib/leaderboards/get-leaderboard";
import {
  METRIC_LABELS,
  PERIOD_LABELS,
  type LeaderboardMetric,
  type LeaderboardPeriod,
} from "@/lib/leaderboards/period";

export const metadata = { title: "Leaderboards" };

const PERIODS = Object.keys(PERIOD_LABELS) as LeaderboardPeriod[];
const METRICS = Object.keys(METRIC_LABELS) as LeaderboardMetric[];

/**
 * Leaderboards.
 *
 * Period and metric are query parameters rather than client state, so a view
 * is linkable and works without JavaScript.
 */
export default function LeaderboardsPage({
  searchParams,
}: PageProps<"/dashboard/leaderboards">) {
  return (
    <div className="flex flex-col gap-7">
      <PageHeader
        eyebrow="Engagement / rankings"
        title="Community leaderboards"
        description="Recognise the members putting the most energy into the server, across the windows that matter."
        actions={
          <>
            <Link href="/dashboard/xp" className="komu-btn komu-btn-secondary">
              <TrendingUp className="h-4 w-4" />
              XP settings
            </Link>
            <Link href="/dashboard/roles" className="komu-btn komu-btn-primary">
              <Award className="h-4 w-4" />
              Role rewards
            </Link>
          </>
        }
      />

      <Suspense fallback={<LeaderboardSkeleton />}>
        <LeaderboardPanel searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function LeaderboardPanel({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireCurrentUser("/dashboard/leaderboards");

  const params = await searchParams;
  const period = readEnum(params.period, PERIODS, "WEEKLY");
  const metric = readEnum(params.metric, METRICS, "XP");

  const guild = await prisma.guild.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  if (!guild) {
    return (
      <EmptyState
        icon={Trophy}
        title="Connect a Discord server first"
        description="Leaderboards appear once a server is connected."
        action={
          <Link href="/setup" className="komu-btn komu-btn-primary">
            Open setup
          </Link>
        }
      />
    );
  }

  const board = await getLeaderboard(guild.id, { period, metric, limit: 25 });
  const podium = board.entries.slice(0, 3);
  const rest = board.entries.slice(3);
  const metricLabel = METRIC_LABELS[metric];

  return (
    <div className="flex flex-col gap-5">
      <div className="komu-card flex flex-col gap-4 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-5">
          <FilterGroup
            label="Period"
            options={PERIODS.map((value) => ({
              value,
              label: PERIOD_LABELS[value],
            }))}
            active={period}
            period={period}
            metric={metric}
            axis="period"
          />
          <FilterGroup
            label="Rank by"
            options={METRICS.map((value) => ({
              value,
              label: METRIC_LABELS[value],
            }))}
            active={metric}
            period={period}
            metric={metric}
            axis="metric"
          />
        </div>
        <Badge tone="accent">
          Top {Math.min(board.entries.length, 25)} of the server
        </Badge>
      </div>

      {board.entries.length === 0 ? (
        <EmptyState
          icon={Trophy}
          title={`No activity in ${PERIOD_LABELS[period].toLowerCase()} yet`}
          description="Once members earn XP or send qualifying messages, the rankings will appear here."
          action={
            <Link href="/dashboard/xp" className="komu-btn komu-btn-secondary">
              Review XP settings
            </Link>
          }
        />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            {podium.map((entry, index) => (
              <PodiumCard
                key={entry.memberId}
                rank={index + 1}
                name={entry.nickname ?? entry.username}
                level={entry.level}
                value={entry.value}
                metricLabel={metricLabel}
              />
            ))}
          </div>

          {rest.length === 0 ? (
            <div className="komu-card flex items-center gap-2.5 px-4 py-3 text-xs text-[color:var(--color-komu-muted)]">
              <Trophy className="h-4 w-4 text-indigo-300" />
              Every ranked member fits on the podium in this range.
            </div>
          ) : null}

          {rest.length > 0 ? (
            <Panel
              title={`${metricLabel} ranking`}
              description={`${PERIOD_LABELS[period]} · Live from stored activity`}
              icon={Trophy}
              action={
                <span className="inline-flex items-center gap-1.5 text-[10px] text-[color:var(--color-komu-dim)]">
                  <Sparkles className="h-3 w-3 text-indigo-300" />
                  Moderator grants excluded
                </span>
              }
              flush
            >
            <div className="overflow-x-auto">
              <table className="komu-table">
                <thead>
                  <tr>
                    <th className="w-16 pl-5">Rank</th>
                    <th>Member</th>
                    <th>Level</th>
                    <th className="text-right pr-5">{metricLabel}</th>
                  </tr>
                </thead>
                <tbody>
                  {rest.map((entry, index) => (
                    <tr key={entry.memberId}>
                      <td className="pl-5">
                        <span className="font-display text-xs font-semibold text-[color:var(--color-komu-dim)]">
                          {String(index + 4).padStart(2, "0")}
                        </span>
                      </td>
                      <td>
                        <div className="flex items-center gap-2.5">
                          <span className="komu-avatar komu-avatar-sm" aria-hidden>
                            {initials(entry.nickname ?? entry.username)}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-xs font-medium text-[color:var(--color-komu-text)]">
                              {entry.nickname ?? entry.username}
                            </span>
                            <span className="block text-[10px] text-[color:var(--color-komu-dim)]">
                              @{entry.username}
                            </span>
                          </span>
                        </div>
                      </td>
                      <td>
                        <Badge tone="neutral">Lv {entry.level}</Badge>
                      </td>
                      <td className="pr-5 text-right font-display text-sm font-semibold tabular-nums text-[color:var(--color-komu-text)]">
                        {entry.value.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
          ) : null}
        </>
      )}

      {board.caveat ? (
        <p className="text-[11px] leading-5 text-[color:var(--color-komu-muted)]">
          {board.caveat}
        </p>
      ) : null}

      <p className="text-[11px] leading-5 text-[color:var(--color-komu-muted)]">
        Moderator XP grants are excluded from rankings, since they are not
        earned.
      </p>
    </div>
  );
}

function PodiumCard({
  rank,
  name,
  level,
  value,
  metricLabel,
}: {
  rank: number;
  name: string;
  level: number;
  value: number;
  metricLabel: string;
}) {
  const config = {
    1: {
      icon: Crown,
      label: "First place",
      border: "border-amber-400/35",
      background: "from-amber-500/[0.12] via-transparent to-transparent",
      iconClass: "border-amber-400/30 bg-amber-500/10 text-amber-300",
      ring: "text-amber-300",
    },
    2: {
      icon: Medal,
      label: "Second place",
      border: "border-slate-300/25",
      background: "from-slate-300/[0.08] via-transparent to-transparent",
      iconClass: "border-slate-300/25 bg-slate-300/10 text-slate-200",
      ring: "text-slate-200",
    },
    3: {
      icon: Award,
      label: "Third place",
      border: "border-orange-400/25",
      background: "from-orange-500/[0.08] via-transparent to-transparent",
      iconClass: "border-orange-400/25 bg-orange-500/10 text-orange-300",
      ring: "text-orange-300",
    },
  }[rank]!;

  const Icon = config.icon;

  return (
    <article
      className={cn(
        "komu-card relative overflow-hidden border bg-gradient-to-br p-4",
        config.border,
        config.background,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className={cn("flex h-9 w-9 items-center justify-center rounded-lg border", config.iconClass)}>
          <Icon className="h-[18px] w-[18px]" />
        </span>
        <span className="komu-label text-[9px]">{config.label}</span>
      </div>

      <div className="mt-4 flex items-center gap-2.5">
        <span
          className={cn(
            "flex h-11 w-11 items-center justify-center rounded-full border border-[color:var(--color-komu-border-muted)] bg-[color:var(--color-komu-surface-raised)] font-display text-sm font-bold",
            config.ring,
          )}
          aria-hidden
        >
          {initials(name)}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[color:var(--color-komu-text)]">
            {name}
          </p>
          <p className="mt-0.5 text-[10px] text-[color:var(--color-komu-muted)]">
            Level {level}
          </p>
        </div>
      </div>

      <div className="mt-4 flex items-end justify-between border-t border-[color:var(--color-komu-border)] pt-3">
        <span className="komu-label">{metricLabel}</span>
        <span className="font-display text-2xl font-bold tracking-[-0.03em] text-[color:var(--color-komu-text)]">
          {value.toLocaleString()}
        </span>
      </div>
    </article>
  );
}

function FilterGroup({
  label,
  options,
  active,
  period,
  metric,
  axis,
}: {
  label: string;
  options: Array<{ value: string; label: string }>;
  active: string;
  period: LeaderboardPeriod;
  metric: LeaderboardMetric;
  axis: "period" | "metric";
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="komu-label text-[9px]">{label}</span>
      <div className="flex flex-wrap gap-1 rounded-lg border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-bg)]/60 p-1">
        {options.map((option) => {
          const nextPeriod = axis === "period" ? option.value : period;
          const nextMetric = axis === "metric" ? option.value : metric;
          const query = new URLSearchParams({
            period: nextPeriod,
            metric: nextMetric,
          });
          const isActive = option.value === active;

          return (
            <Link
              key={option.value}
              href={`/dashboard/leaderboards?${query.toString()}`}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "rounded-md px-2.5 py-1.5 text-[11px] font-medium transition",
                isActive
                  ? "bg-indigo-500 text-white shadow-sm"
                  : "text-[color:var(--color-komu-muted)] hover:bg-white/[0.04] hover:text-[color:var(--color-komu-text)]",
              )}
            >
              {option.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

/** Accept only a known value from the query string. */
function readEnum<T extends string>(
  value: string | string[] | undefined,
  allowed: T[],
  fallback: T,
): T {
  const first = Array.isArray(value) ? value[0] : value;
  return allowed.includes(first as T) ? (first as T) : fallback;
}

function LeaderboardSkeleton() {
  return (
    <div className="flex flex-col gap-5" aria-hidden>
      <div className="h-20 animate-pulse rounded-2xl border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)]" />
      <div className="grid gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((index) => (
          <div
            key={index}
            className="h-44 animate-pulse rounded-2xl border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)]"
          />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-2xl border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)]" />
    </div>
  );
}

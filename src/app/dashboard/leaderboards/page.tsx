import { Suspense } from "react";
import Link from "next/link";

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
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Leaderboards</h1>
        <p className="text-sm text-[color:var(--color-komu-muted)]">
          The most active members in your community.
        </p>
      </header>

      <Suspense fallback={<PanelSkeleton />}>
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
      <p className="rounded-lg border border-[color:var(--color-komu-border)] p-4 text-sm text-[color:var(--color-komu-muted)]">
        Connect a Discord server first.
      </p>
    );
  }

  const board = await getLeaderboard(guild.id, { period, metric, limit: 25 });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap gap-4">
        <Tabs
          label="Period"
          options={PERIODS.map((value) => ({
            value,
            label: PERIOD_LABELS[value],
          }))}
          active={period}
          metric={metric}
        />
        <Tabs
          label="Rank by"
          options={METRICS.map((value) => ({
            value,
            label: METRIC_LABELS[value],
          }))}
          active={metric}
          period={period}
        />
      </div>

      {board.entries.length === 0 ? (
        <p className="rounded-lg border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] p-6 text-sm text-[color:var(--color-komu-muted)]">
          No activity in {PERIOD_LABELS[period].toLowerCase()} yet.
        </p>
      ) : (
        <ol className="flex flex-col gap-2">
          {board.entries.map((entry, index) => (
            <li
              key={entry.memberId}
              className="flex items-center gap-4 rounded-lg border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] px-4 py-3"
            >
              <span className="w-6 text-sm font-semibold text-[color:var(--color-komu-muted)]">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1 truncate">
                {entry.nickname ?? entry.username}
              </span>
              <span className="text-sm text-[color:var(--color-komu-muted)]">
                Lv {entry.level}
              </span>
              <span className="w-24 text-right font-medium tabular-nums">
                {entry.value.toLocaleString()}
              </span>
            </li>
          ))}
        </ol>
      )}

      {board.caveat ? (
        <p className="text-xs text-[color:var(--color-komu-muted)]">
          {board.caveat}
        </p>
      ) : null}

      <p className="text-xs text-[color:var(--color-komu-muted)]">
        Moderator XP grants are excluded from rankings, since they are not
        earned.
      </p>
    </div>
  );
}

/** Link-based tabs that preserve the other axis. */
function Tabs({
  label,
  options,
  active,
  period,
  metric,
}: {
  label: string;
  options: Array<{ value: string; label: string }>;
  active: string;
  period?: LeaderboardPeriod;
  metric?: LeaderboardMetric;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs tracking-wider text-[color:var(--color-komu-muted)] uppercase">
        {label}
      </span>
      <div className="flex flex-wrap gap-1">
        {options.map((option) => {
          const query = new URLSearchParams({
            period: period ?? active,
            metric: metric ?? active,
          });

          if (period) query.set("metric", metric ?? "XP");
          if (metric) query.set("period", period ?? "WEEKLY");

          const isActive = option.value === active;

          return (
            <Link
              key={option.value}
              href={`/dashboard/leaderboards?${query.toString()}`}
              aria-current={isActive ? "page" : undefined}
              className={
                isActive
                  ? "rounded-md bg-[color:var(--color-komu-accent)] px-3 py-1.5 text-sm font-medium text-white"
                  : "rounded-md border border-[color:var(--color-komu-border)] px-3 py-1.5 text-sm text-[color:var(--color-komu-muted)] transition hover:bg-[color:var(--color-komu-surface)] hover:text-[color:var(--color-komu-text)]"
              }
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

function PanelSkeleton() {
  return (
    <div
      className="h-80 animate-pulse rounded-lg border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)]"
      aria-hidden
    />
  );
}
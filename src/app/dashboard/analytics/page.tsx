import Link from "next/link";
import { Suspense } from "react";

import { getAnalytics } from "@/lib/analytics/queries";
import {
  ACTIVITY_CAVEAT,
  DEFAULT_RANGE,
  isAnalyticsRange,
  RANGE_LABELS,
  type AnalyticsRange,
} from "@/lib/analytics/period";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { ActivityChart } from "./ActivityChart";

export const metadata = { title: "Analytics" };

/**
 * Community analytics (PRD section 7.12).
 *
 * Plain aggregates over data the application already stores. No warehouse, no
 * event bus, no analytics cache: for one server's worth of data those would be
 * infrastructure to maintain rather than speed worth having.
 *
 * The range arrives as a search param, so the read sits behind `<Suspense>`
 * with `searchParams` inside it, which is what Cache Components expects for
 * request-time data.
 */
export default function AnalyticsPage({ searchParams }: PageProps<"/dashboard/analytics">) {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
          <p className="text-sm text-[color:var(--color-komu-muted)]">
            How the community has been doing, over the last few weeks.
          </p>
        </div>

        <Suspense fallback={<div className="h-9 w-64" />}>
          <RangePicker searchParams={searchParams} />
        </Suspense>
      </header>

      <Suspense fallback={<PanelSkeleton />}>
        <AnalyticsPanel searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

/**
 * Read the range from the query string.
 *
 * An unrecognised value falls back rather than erroring, so a hand-edited or
 * stale link shows the default range instead of a blank page.
 */
async function readRange(
  searchParams: Promise<Record<string, string | string[] | undefined>>,
): Promise<AnalyticsRange> {
  const params = await searchParams;
  const requested = Array.isArray(params?.range) ? params?.range[0] : params?.range;

  return isAnalyticsRange(requested) ? requested : DEFAULT_RANGE;
}

async function RangePicker({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const current = await readRange(searchParams);

  return (
    <nav className="flex gap-1" aria-label="Date range">
      {(Object.keys(RANGE_LABELS) as AnalyticsRange[]).map((range) => (
        <Link
          key={range}
          href={`/dashboard/analytics?range=${range}`}
          aria-current={range === current ? "true" : undefined}
          className={[
            "rounded-md border border-[color:var(--color-komu-border)] px-3 py-1.5 text-sm transition",
            range === current
              ? "bg-[color:var(--color-komu-accent)] text-white"
              : "hover:bg-[color:var(--color-komu-surface)]",
          ].join(" ")}
        >
          {RANGE_LABELS[range]}
        </Link>
      ))}
    </nav>
  );
}

async function AnalyticsPanel({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireCurrentUser("/dashboard/analytics");

  const range = await readRange(searchParams);

  const { totals, daily, unavailable } = await getAnalytics(range);

  const { totalMembers, newMembers, activeMembers, messages, xpEarned, attendance } = totals;

  return (
    <div className="flex flex-col gap-8">
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Members tracked" value={totalMembers.toLocaleString()} />
        <StatCard
          label={`New members (${totals.rangeLabel.toLowerCase()})`}
          value={newMembers.toLocaleString()}
        />
        <StatCard
          label={`Active members (${totals.rangeLabel.toLowerCase()})`}
          value={activeMembers.toLocaleString()}
        />
        <StatCard label="Messages" value={messages.toLocaleString()} />
        <StatCard label="XP earned" value={xpEarned.toLocaleString()} />
        <StatCard label="Stream attendance" value={attendance.toLocaleString()} />
        <StatCard label="Rewards granted" value={totals.rewardsGranted.toLocaleString()} />
        <StatCard
          label="Challenge completions"
          value={totals.challengesCompleted.toLocaleString()}
        />
        <StatCard
          label="Achievements unlocked"
          value={totals.achievementsUnlocked.toLocaleString()}
        />
      </section>

      <section className="flex flex-col gap-6 rounded-lg border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] p-6">
        <h2 className="font-semibold">Daily activity</h2>

        <ActivityChart buckets={daily} metric="messages" label="Messages per day" />
        <ActivityChart buckets={daily} metric="activeMembers" label="Active members per day" />
        <ActivityChart buckets={daily} metric="xp" label="XP earned per day" />
        <ActivityChart buckets={daily} metric="attendance" label="Stream attendance per day" />

        <p className="text-xs text-[color:var(--color-komu-muted)]">{ACTIVITY_CAVEAT}</p>
      </section>

      {unavailable.length > 0 ? (
        <section className="rounded-lg border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] p-4">
          <h2 className="text-sm font-semibold">Not available yet</h2>
          <ul className="mt-2 flex list-inside list-disc flex-col gap-1 text-sm text-[color:var(--color-komu-muted)]">
            {unavailable.map((entry) => (
              <li key={entry.metric}>
                <span className="font-medium">{entry.metric}</span> — {entry.reason}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="text-xs text-[color:var(--color-komu-muted)]">
        Days are counted in UTC, and ranges include today. Every figure is
        calculated from stored application data at the moment this page loads.
      </p>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] p-5">
      <p className="text-xs tracking-wider text-[color:var(--color-komu-muted)] uppercase">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </div>
  );
}

function PanelSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-hidden>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, index) => (
          <div
            key={index}
            className="h-24 animate-pulse rounded-lg border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)]"
          />
        ))}
      </div>
      <div className="h-72 animate-pulse rounded-lg border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)]" />
    </div>
  );
}
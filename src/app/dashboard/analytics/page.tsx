import {
  Activity,
  CalendarDays,
  Gift,
  Info,
  MessageSquare,
  Radio,
  Sparkles,
  Trophy,
  UserPlus,
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
  ProgressBar,
  cn,
} from "@/components/dashboard/ui";
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
    <div className="flex flex-col gap-7">
      <PageHeader
        eyebrow="Intelligence / community analytics"
        title="Community analytics"
        description="How the community has been doing, measured from the activity Komu already stores."
        actions={
          <Suspense fallback={<div className="h-10 w-64 animate-pulse rounded-lg bg-white/[0.04]" />}>
            <RangePicker searchParams={searchParams} />
          </Suspense>
        }
      />

      <Suspense fallback={<AnalyticsSkeleton />}>
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
    <nav
      className="flex flex-wrap gap-1 rounded-lg border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-bg)]/70 p-1"
      aria-label="Date range"
    >
      {(Object.keys(RANGE_LABELS) as AnalyticsRange[]).map((range) => (
        <Link
          key={range}
          href={`/dashboard/analytics?range=${range}`}
          aria-current={range === current ? "true" : undefined}
          className={cn(
            "rounded-md px-3 py-1.5 text-[11px] font-medium transition",
            range === current
              ? "bg-indigo-500 text-white shadow-sm"
              : "text-[color:var(--color-komu-muted)] hover:bg-white/[0.04] hover:text-[color:var(--color-komu-text)]",
          )}
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

  const {
    totalMembers,
    newMembers,
    activeMembers,
    messages,
    xpEarned,
    attendance,
    rewardsGranted,
    challengesCompleted,
    achievementsUnlocked,
  } = totals;

  const activeRate =
    totalMembers > 0 ? Math.round((activeMembers / totalMembers) * 100) : 0;
  const xpPerActive =
    activeMembers > 0 ? Math.round(xpEarned / activeMembers) : 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Messages"
          value={messages.toLocaleString()}
          hint={`${totals.rangeLabel} · only messages that count`}
          icon={MessageSquare}
          tone="accent"
        />
        <MetricCard
          label="Active members"
          value={activeMembers.toLocaleString()}
          hint={`${activeRate}% of ${totalMembers.toLocaleString()} tracked`}
          icon={Users}
          tone="success"
          footer={<ProgressBar value={activeRate} tone="success" />}
        />
        <MetricCard
          label="XP earned"
          value={xpEarned.toLocaleString()}
          hint={`${xpPerActive.toLocaleString()} XP per active member`}
          icon={Zap}
          tone="violet"
        />
        <MetricCard
          label="New members"
          value={newMembers.toLocaleString()}
          hint={`Joined ${totals.rangeLabel.toLowerCase()}`}
          icon={UserPlus}
          tone="warning"
        />
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-12">
        <Panel
          className="xl:col-span-8"
          title="Conversation volume"
          description={`Daily messages and active members · ${totals.rangeLabel}`}
          icon={MessageSquare}
          action={<Badge tone="accent">{daily.length} days</Badge>}
        >
          <div className="flex flex-col gap-6">
            <ActivityChart buckets={daily} metric="messages" label="Messages per day" />
            <ActivityChart
              buckets={daily}
              metric="activeMembers"
              label="Active members per day"
            />
          </div>
        </Panel>

        <Panel
          className="xl:col-span-4"
          title="Engagement mix"
          description="The rest of the community economy."
          icon={Activity}
        >
          <div className="flex flex-col gap-2">
            <StatLine
              icon={Radio}
              label="Stream attendance"
              value={attendance.toLocaleString()}
              hint="Recorded stream visits"
            />
            <StatLine
              icon={Gift}
              label="Rewards granted"
              value={rewardsGranted.toLocaleString()}
              hint="Automatic and manual"
            />
            <StatLine
              icon={Trophy}
              label="Challenge completions"
              value={challengesCompleted.toLocaleString()}
              hint="Members who finished a quest"
            />
            <StatLine
              icon={Sparkles}
              label="Achievements unlocked"
              value={achievementsUnlocked.toLocaleString()}
              hint="Permanent milestones"
            />
          </div>

          <div className="mt-4 rounded-xl border border-indigo-400/20 bg-gradient-to-br from-indigo-500/[0.09] to-violet-500/[0.03] p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="komu-label">Active-member rate</p>
                <p className="mt-1 font-display text-2xl font-bold tracking-[-0.03em] text-[color:var(--color-komu-text)]">
                  {activeRate}%
                </p>
              </div>
              <CalendarDays className="h-5 w-5 text-indigo-300" />
            </div>
            <p className="mt-2 text-[10px] leading-4 text-[color:var(--color-komu-muted)]">
              {activeMembers.toLocaleString()} of {totalMembers.toLocaleString()} tracked
              members {activeMembers === 1 ? "was" : "were"} active{" "}
              {totals.rangeLabel.toLowerCase()}.
            </p>
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel
          title="Progression velocity"
          description={`XP awarded per day · ${totals.rangeLabel}`}
          icon={Zap}
        >
          <ActivityChart buckets={daily} metric="xp" label="XP earned per day" />
        </Panel>

        <Panel
          title="Live attendance"
          description={`Stream visits per day · ${totals.rangeLabel}`}
          icon={Radio}
        >
          <ActivityChart
            buckets={daily}
            metric="attendance"
            label="Stream attendance per day"
          />
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-12">
        <Panel
          className="xl:col-span-7"
          title="How to read this"
          description="The limits are deliberate, so the numbers stay honest."
          icon={Info}
        >
          <p className="text-xs leading-6 text-[color:var(--color-komu-muted)]">
            {ACTIVITY_CAVEAT} Days are counted in UTC, and the selected range
            includes today. Every figure is calculated from stored application
            data at the moment this page loads.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              href="/dashboard/leaderboards"
              className="komu-btn komu-btn-secondary min-h-8 px-2.5 py-1 text-[11px]"
            >
              <Trophy className="h-3.5 w-3.5" />
              Open leaderboard
            </Link>
            <Link
              href="/dashboard/streams"
              className="komu-btn komu-btn-secondary min-h-8 px-2.5 py-1 text-[11px]"
            >
              <Radio className="h-3.5 w-3.5" />
              Connected channels
            </Link>
          </div>
        </Panel>

        <Panel
          className="xl:col-span-5"
          title="Not available yet"
          description="Shown rather than silently omitted."
          icon={Info}
          action={<Badge tone="neutral">{unavailable.length}</Badge>}
        >
          {unavailable.length === 0 ? (
            <p className="text-xs leading-5 text-[color:var(--color-komu-muted)]">
              Every metric on this page has a data source.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {unavailable.map((entry) => (
                <li
                  key={entry.metric}
                  className="rounded-lg border border-[color:var(--color-komu-border)] bg-white/[0.015] px-3 py-2 text-xs leading-5 text-[color:var(--color-komu-muted)]"
                >
                  <span className="font-medium text-[color:var(--color-komu-text)]">
                    {entry.metric}
                  </span>{" "}
                  — {entry.reason}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

function StatLine({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-[color:var(--color-komu-border)] bg-white/[0.012] px-3 py-2.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-indigo-400/20 bg-indigo-500/[0.08] text-indigo-300">
        <Icon className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-[color:var(--color-komu-text)]">{label}</p>
        <p className="text-[10px] text-[color:var(--color-komu-dim)]">{hint}</p>
      </div>
      <span className="font-display text-sm font-bold tabular-nums text-[color:var(--color-komu-text)]">
        {value}
      </span>
    </div>
  );
}

function AnalyticsSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <div
            key={index}
            className="h-32 animate-pulse rounded-2xl border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)]"
          />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-12">
        <div className="h-[420px] animate-pulse rounded-2xl border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] xl:col-span-8" />
        <div className="h-[420px] animate-pulse rounded-2xl border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] xl:col-span-4" />
      </div>
    </div>
  );
}

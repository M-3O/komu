import Link from "next/link";
import { Suspense } from "react";

import { getAnalytics } from "@/lib/analytics/queries";
import { getDashboardStats } from "@/lib/dashboard/get-dashboard-stats";

export const metadata = { title: "Overview" };

/**
 * Dashboard overview.
 *
 * A short read on the last 30 days, linking to the full analytics page. The
 * data access sits in its own component behind `<Suspense>`: the outer page
 * renders immediately and the stats stream in, which is what Cache Components
 * expects for uncached data (database reads here).
 */
export default function DashboardPage() {
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Overview</h1>
      </header>

      <Suspense fallback={<StatsSkeleton />}>
        <DashboardStats />
      </Suspense>

      <Suspense fallback={<StatsSkeleton />}>
        <RecentActivity />
      </Suspense>

      <section className="rounded-lg border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] p-6">
        <h2 className="font-semibold">Next steps</h2>
        <ol className="mt-3 flex list-inside list-decimal flex-col gap-1.5 text-sm text-[color:var(--color-komu-muted)]">
          <li>Log in with Discord to confirm your server</li>
          <li>Connect Twitch, YouTube or Kick</li>
          <li>Choose the Discord channel for stream alerts</li>
          <li>Enable XP for community activity</li>
        </ol>
      </section>
    </div>
  );
}

/** The handful of numbers worth seeing without changing page. */
async function RecentActivity() {
  const { totals } = await getAnalytics("30D");

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Last 30 days</h2>
        <Link
          href="/dashboard/analytics"
          className="text-sm text-[color:var(--color-komu-accent)] hover:underline"
        >
          Full analytics
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Active members" value={totals.activeMembers.toLocaleString()} />
        <StatCard label="Messages" value={totals.messages.toLocaleString()} />
        <StatCard label="Stream attendance" value={totals.attendance.toLocaleString()} />
        <StatCard label="New members" value={totals.newMembers.toLocaleString()} />
      </div>
    </section>
  );
}

async function DashboardStats() {
  const { guild, memberCount, streamingAccountCount } =
    await getDashboardStats();

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-[color:var(--color-komu-muted)]">
        {guild
          ? `Connected to ${guild.name}`
          : "No Discord server connected yet"}
      </p>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Server" value={guild ? "Connected" : "Not set up"} />
        <StatCard label="Members tracked" value={memberCount.toString()} />
        <StatCard
          label="Streaming channels"
          value={streamingAccountCount.toString()}
        />
      </div>
    </div>
  );
}

function StatsSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden>
      <div className="h-4 w-48 animate-pulse rounded bg-[color:var(--color-komu-surface-raised)]" />
      <div className="grid gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((index) => (
          <div
            key={index}
            className="h-24 animate-pulse rounded-lg border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)]"
          />
        ))}
      </div>
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
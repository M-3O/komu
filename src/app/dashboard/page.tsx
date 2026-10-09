import Link from "next/link";
import { Suspense } from "react";

import { getAnalytics } from "@/lib/analytics/queries";
import { getDashboardStats } from "@/lib/dashboard/get-dashboard-stats";
import { getSetupChecklist } from "@/lib/dashboard/setup-checklist";

export const metadata = { title: "Overview" };

/**
 * Dashboard overview.
 *
 * A short read on the last 30 days, linking to the full analytics page, plus a
 * setup checklist built from the real state of the installation. The data
 * access sits in its own components behind `<Suspense>`: the outer page renders
 * immediately and the stats stream in, which is what Cache Components expects
 * for uncached data (database reads here).
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

      <Suspense fallback={<ChecklistSkeleton />}>
        <SetupChecklistPanel />
      </Suspense>
    </div>
  );
}

/**
 * The setup checklist, reflecting what is actually configured.
 *
 * This replaced a fixed list of steps that told every creator to do the same
 * things, including ones they had already finished. A checklist that does not
 * change is worse than none, because it teaches people to stop reading it.
 */
async function SetupChecklistPanel() {
  const { steps, completed, total, finished } = await getSetupChecklist();

  const outstanding = steps.filter((step) => !step.done);

  return (
    <section className="rounded-lg border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">Setup</h2>
        <span className="text-sm text-[color:var(--color-komu-muted)]">
          {completed} of {total} done
        </span>
      </div>

      {finished ? (
        <p className="mt-3 text-sm text-[color:var(--color-komu-muted)]">
          Everything is set up. Alerts will post when you go live.
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {steps.map((step) => (
            <li key={step.id} className="flex items-start gap-3 text-sm">
              <span
                aria-hidden
                className={
                  step.done
                    ? "mt-0.5 text-[color:var(--color-komu-accent)]"
                    : "mt-0.5 text-[color:var(--color-komu-muted)]"
                }
              >
                {step.done ? "✓" : "○"}
              </span>

              <span className={step.done ? "opacity-60" : ""}>
                <span className="font-medium">{step.label}</span>
                <span className="block text-[color:var(--color-komu-muted)]">
                  {step.detail}
                </span>
              </span>

              {step.href ? (
                <Link
                  href={step.href}
                  className="ml-auto shrink-0 self-center text-xs text-[color:var(--color-komu-accent)] hover:underline"
                >
                  Set up
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {outstanding.length > 0 && !finished ? (
        <p className="mt-4 text-xs text-[color:var(--color-komu-muted)]">
          The alert role and role rules are optional. Everything else is needed
          before alerts can work.
        </p>
      ) : null}
    </section>
  );
}

function ChecklistSkeleton() {
  return (
    <div
      className="h-56 animate-pulse rounded-lg border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)]"
      aria-hidden
    />
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
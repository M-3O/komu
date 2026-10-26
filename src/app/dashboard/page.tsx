import {
  Activity,
  ArrowUpRight,
  BarChart3,
  Check,
  Circle,
  Gift,
  Medal,
  MessageSquare,
  Plus,
  Radio,
  Sparkles,
  Trophy,
  Users,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import {
  Badge,
  EmptyState,
  MetricCard,
  PageHeader,
  Panel,
  PlatformTile,
  ProgressBar,
  ProgressRing,
  StatusDot,
  cn,
  providerLabel,
} from "@/components/dashboard/ui";
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
    <div className="flex flex-col gap-7">
      <PageHeader
        eyebrow="Operations command"
        title="Command overview"
        description="A live read on your community, connected channels, and launch readiness."
        actions={
          <>
            <Link href="/dashboard/analytics" className="komu-btn komu-btn-secondary">
              <BarChart3 className="h-4 w-4" />
              Full analytics
            </Link>
            <Link href="/dashboard/streams" className="komu-btn komu-btn-primary">
              <Plus className="h-4 w-4" />
              Connect channel
            </Link>
          </>
        }
      />

      <Suspense fallback={<OverviewSkeleton />}>
        <OverviewBoard />
      </Suspense>

      <Suspense fallback={<ChecklistSkeleton />}>
        <SetupChecklistPanel />
      </Suspense>
    </div>
  );
}

async function OverviewBoard() {
  const [report, stats] = await Promise.all([
    getAnalytics("30D"),
    getDashboardStats(),
  ]);

  const { totals } = report;
  const { guild, memberCount, channels, alertsEnabled } = stats;
  const engagement =
    totals.totalMembers > 0
      ? Math.round((totals.activeMembers / totals.totalMembers) * 100)
      : 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Members tracked"
          value={memberCount.toLocaleString()}
          hint={`${totals.newMembers.toLocaleString()} joined in the last 30 days`}
          icon={Users}
          tone="accent"
        />
        <MetricCard
          label="Active members"
          value={totals.activeMembers.toLocaleString()}
          hint={`${engagement}% of the server earned XP`}
          icon={Activity}
          tone="success"
          footer={<ProgressBar value={engagement} tone="success" />}
        />
        <MetricCard
          label="Messages"
          value={totals.messages.toLocaleString()}
          hint={`${totals.xpEarned.toLocaleString()} XP awarded · qualifying messages`}
          icon={MessageSquare}
          tone="violet"
        />
        <MetricCard
          label="Connected channels"
          value={channels.length.toString()}
          hint={`${alertsEnabled} of ${channels.length || 0} alert routes armed`}
          icon={Radio}
          tone={alertsEnabled === channels.length && channels.length > 0 ? "success" : "warning"}
          footer={
            <div className="flex items-center gap-2">
              <StatusDot tone={alertsEnabled > 0 ? "success" : "neutral"} pulse={alertsEnabled > 0} />
              <span className="text-[11px] text-[color:var(--color-komu-muted)]">
                {channels.length === 0
                  ? "No channels connected"
                  : alertsEnabled === channels.length
                    ? "Every channel can dispatch"
                    : "Some channels need an alert route"}
              </span>
            </div>
          }
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-12">
        <Panel
          className="xl:col-span-7"
          title="Broadcast command center"
          description="Connected creators and the routes that announce them."
          icon={Radio}
          action={
            <Link
              href="/dashboard/streams"
              className="inline-flex items-center gap-1 text-xs font-medium text-indigo-300 transition hover:text-indigo-200"
            >
              Manage channels <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          }
        >
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-indigo-400/20 bg-gradient-to-r from-indigo-500/[0.09] to-violet-500/[0.04] px-3.5 py-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-indigo-400/25 bg-indigo-500/10 text-indigo-300">
                <Sparkles className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-[color:var(--color-komu-text)]">
                  {guild?.name ?? "Your Discord server"}
                </p>
                <p className="text-[10px] text-[color:var(--color-komu-muted)]">
                  {channels.length} connected {channels.length === 1 ? "pipeline" : "pipelines"} ·{" "}
                  {alertsEnabled} dispatch {alertsEnabled === 1 ? "route" : "routes"}
                </p>
              </div>
            </div>
            <Badge tone={alertsEnabled > 0 ? "success" : "warning"} dot>
              {alertsEnabled > 0 ? "Dispatch armed" : "Route needed"}
            </Badge>
          </div>

          {channels.length === 0 ? (
            <EmptyState
              icon={Radio}
              title="No streaming channels yet"
              description="Connect Twitch, YouTube, or Kick so Komu can watch for live broadcasts."
              action={
                <Link href="/dashboard/streams" className="komu-btn komu-btn-primary">
                  <Plus className="h-4 w-4" /> Connect a channel
                </Link>
              }
            />
          ) : (
            <ul className="flex flex-col gap-2.5">
              {channels.map((channel) => (
                <li
                  key={channel.id}
                  className="komu-card-interactive flex flex-wrap items-center gap-3 rounded-xl border border-[color:var(--color-komu-border)] bg-white/[0.015] p-3"
                >
                  <PlatformTile provider={channel.provider} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-[color:var(--color-komu-text)]">
                      {channel.displayName ?? channel.username}
                    </p>
                    <p className="truncate text-[11px] text-[color:var(--color-komu-muted)]">
                      {providerLabel(channel.provider)} · @{channel.username}
                    </p>
                  </div>
                  <Badge tone={channel.alertConfig?.enabled ? "success" : "warning"}>
                    {channel.alertConfig?.enabled ? "Alerts on" : "Not routed"}
                  </Badge>
                  <Link
                    href="/dashboard/alerts"
                    className="text-[11px] font-medium text-indigo-300 hover:text-indigo-200"
                  >
                    Configure
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {channels.length > 0 ? (
            <div className="mt-3 flex items-center justify-between gap-3 border-t border-[color:var(--color-komu-border)] pt-3">
              <p className="text-[11px] text-[color:var(--color-komu-muted)]">
                Alerts post through Discord REST; the bot is not required for delivery.
              </p>
              <Link
                href="/dashboard/alerts"
                className="shrink-0 text-[11px] font-medium text-indigo-300 hover:text-indigo-200"
              >
                Open alert routing
              </Link>
            </div>
          ) : null}
        </Panel>

        <Panel
          className="xl:col-span-5"
          title="Community pulse"
          description="The last 30 days of real activity."
          icon={Activity}
          action={
            <Link
              href="/dashboard/analytics"
              className="inline-flex items-center gap-1 text-xs font-medium text-indigo-300 transition hover:text-indigo-200"
            >
              Open <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          }
        >
          <div className="grid grid-cols-2 gap-2.5">
            <PulseStat
              icon={Users}
              label="New members"
              value={totals.newMembers}
              tone="accent"
            />
            <PulseStat
              icon={Zap}
              label="Stream visits"
              value={totals.attendance}
              tone="success"
            />
            <PulseStat
              icon={Gift}
              label="Rewards paid"
              value={totals.rewardsGranted}
              tone="violet"
            />
            <PulseStat
              icon={Trophy}
              label="Challenges cleared"
              value={totals.challengesCompleted}
              tone="warning"
            />
          </div>

          <div className="mt-3 rounded-xl border border-[color:var(--color-komu-border)] bg-white/[0.015] p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="komu-label">Member engagement</p>
              <span className="font-display text-xs font-bold text-[color:var(--color-komu-text)]">
                {engagement}%
              </span>
            </div>
            <ProgressBar value={engagement} tone="accent" className="mt-2" />
            <p className="mt-2 text-[11px] leading-4 text-[color:var(--color-komu-muted)]">
              {totals.activeMembers.toLocaleString()} of{" "}
              {totals.totalMembers.toLocaleString()} members earned XP in this window.
            </p>
          </div>

          <div className="mt-3 flex items-center justify-between border-t border-[color:var(--color-komu-border)] pt-3">
            <span className="inline-flex items-center gap-1.5 text-[11px] text-[color:var(--color-komu-muted)]">
              <Medal className="h-3.5 w-3.5 text-amber-300" />
              {totals.achievementsUnlocked.toLocaleString()} achievements unlocked
            </span>
            <Link
              href="/dashboard/leaderboards"
              className="text-[11px] font-medium text-indigo-300 hover:text-indigo-200"
            >
              Leaderboard
            </Link>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function PulseStat({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Users;
  label: string;
  value: number;
  tone: "accent" | "success" | "violet" | "warning";
}) {
  const color = {
    accent: "text-indigo-300",
    success: "text-emerald-300",
    violet: "text-violet-300",
    warning: "text-amber-300",
  }[tone];

  return (
    <div className="rounded-xl border border-[color:var(--color-komu-border)] bg-white/[0.015] p-3">
      <div className="flex items-center gap-2">
        <Icon className={cn("h-3.5 w-3.5", color)} />
        <p className="komu-label text-[9px]">{label}</p>
      </div>
      <p className="mt-2 font-display text-xl font-bold tracking-[-0.02em] text-[color:var(--color-komu-text)]">
        {value.toLocaleString()}
      </p>
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
  const percent = total > 0 ? (completed / total) * 100 : 0;
  const outstanding = steps.filter((step) => !step.done);

  return (
    <Panel
      title="Launch checklist"
      description="The real state of this installation, not a fixed script."
      icon={Check}
      action={
        <Badge tone={finished ? "success" : "accent"} dot={finished}>
          {completed} / {total} complete
        </Badge>
      }
    >
      <div className="grid gap-5 lg:grid-cols-[220px_1fr]">
        <div className="flex items-center gap-4 rounded-xl border border-[color:var(--color-komu-border)] bg-white/[0.015] p-4 lg:flex-col lg:items-start">
          <ProgressRing
            value={percent}
            label={`${Math.round(percent)}%`}
            tone={finished ? "success" : "accent"}
          />
          <div>
            <p className="font-display text-sm font-semibold text-[color:var(--color-komu-text)]">
              {finished ? "Ready to broadcast" : "Finish the launch path"}
            </p>
            <p className="mt-1 text-[11px] leading-4 text-[color:var(--color-komu-muted)]">
              {finished
                ? "Everything is set up. Alerts will post when you go live."
                : `${outstanding.length} ${outstanding.length === 1 ? "step" : "steps"} left in the launch path.`}
            </p>
          </div>
        </div>

        <ul className="grid gap-2 sm:grid-cols-2">
          {steps.map((step) => (
            <li
              key={step.id}
              className={cn(
                "flex items-start gap-2.5 rounded-xl border p-3",
                step.done
                  ? "border-[color:var(--color-komu-border)] bg-white/[0.01]"
                  : "border-indigo-400/20 bg-indigo-500/[0.035]",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                  step.done
                    ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-300"
                    : "border-[color:var(--color-komu-border-muted)] text-[color:var(--color-komu-dim)]",
                )}
                aria-hidden
              >
                {step.done ? (
                  <Check className="h-2.5 w-2.5" strokeWidth={3} />
                ) : (
                  <Circle className="h-2 w-2" />
                )}
              </span>

              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "text-xs font-semibold",
                    step.done
                      ? "text-[color:var(--color-komu-muted)]"
                      : "text-[color:var(--color-komu-text)]",
                  )}
                >
                  {step.label}
                </p>
                <p className="mt-0.5 text-[10px] leading-4 text-[color:var(--color-komu-dim)]">
                  {step.detail}
                </p>
              </div>

              {step.href ? (
                <Link
                  href={step.href}
                  className="shrink-0 text-[10px] font-semibold text-indigo-300 hover:text-indigo-200"
                >
                  Set up
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      </div>

      {outstanding.length > 0 && !finished ? (
        <p className="mt-4 text-[11px] text-[color:var(--color-komu-muted)]">
          The alert role and role rules are optional. A streaming account and an
          alert channel are all that live alerts require; the rest is
          recommended setup.
        </p>
      ) : null}
    </Panel>
  );
}

function OverviewSkeleton() {
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
        <div className="h-80 animate-pulse rounded-2xl border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] xl:col-span-7" />
        <div className="h-80 animate-pulse rounded-2xl border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] xl:col-span-5" />
      </div>
    </div>
  );
}

function ChecklistSkeleton() {
  return (
    <div
      className="h-64 animate-pulse rounded-2xl border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)]"
      aria-hidden
    />
  );
}

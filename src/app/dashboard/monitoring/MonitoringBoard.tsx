"use client";

import { Activity, BellRing, Clock3, Coins, Database, Radio, RefreshCw, ShieldCheck, WifiOff, Workflow } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Badge, IconTile, PageHeader, Panel, type Tone } from "@/components/dashboard/ui";
import { COMPONENT_LABELS, STATES, dashboardView, initialSnapshotAge, SNAPSHOT_FRESH_MS, type DashboardSnapshot, type Observation } from "@/lib/monitoring/dashboard-model";
import { createMonitoringRefresh, requestMonitoringSnapshot, type RefreshStatus } from "@/lib/monitoring/dashboard-refresh";
import type { HealthState } from "@/lib/monitoring/health";

const tones: Record<HealthState, Tone> = { healthy: "success", degraded: "warning", unhealthy: "danger", unknown: "neutral" };
const names: Record<HealthState, string> = { healthy: "Healthy", degraded: "Degraded", unhealthy: "Unhealthy", unknown: "Unknown" };
function StateBadge({ state }: { state: HealthState }) { return <Badge tone={tones[state]}>{names[state]}</Badge>; }
function since(stamp: number | null, now: number) {
  if (stamp === null) return "Not observed";
  const seconds = Math.max(0, Math.floor((now - stamp) / 1000));
  return seconds < 60 ? "Just now" : seconds < 3600 ? Math.floor(seconds / 60) + "m ago" : Math.floor(seconds / 3600) + "h ago";
}
function Time({ value, now }: { value: number | null; now: number }) {
  if (value === null) return <span className="text-slate-500">Not observed</span>;
  const date = new Date(value).toISOString();
  return <time dateTime={date} title={date}>{since(value, now)}</time>;
}
function Freshness({ entry }: { entry: Observation }) {
  return <span className="text-xs text-slate-400">{entry.reason === "SOURCE_UNAVAILABLE" ? "Source unavailable" : entry.lastObservedAt === null ? "No recent evidence" : entry.stale ? "Observation is stale" : "Recent observation"}</span>;
}

export function MonitoringBoard({ initial }: { initial: DashboardSnapshot }) {
  const [snapshot, setSnapshot] = useState(initial);
  const [status, setStatus] = useState<RefreshStatus>("ready");
  const [elapsed, setElapsed] = useState(0);
  const [readFailed, setReadFailed] = useState(false);
  const anchor = useRef(0);
  const refresh = useRef<(() => void) | null>(null);
  useEffect(() => {
    const initialAge = initialSnapshotAge(initial.generatedAt, Date.now());
    anchor.current = performance.now() - initialAge;
    let mounted = true;
    queueMicrotask(() => { if (mounted) setElapsed(initialAge); });
    const control = createMonitoringRefresh({
      request: requestMonitoringSnapshot,
      active: () => !document.hidden && navigator.onLine !== false,
      onSnapshot: next => { anchor.current = performance.now(); setSnapshot(next); setElapsed(0); setReadFailed(false); },
      onStatus: value => { setStatus(value); if (value === "unavailable") setReadFailed(true); },
    });
    refresh.current = () => { setElapsed(Math.max(0, performance.now() - anchor.current)); void control.refresh(); };
    const resume = () => { setElapsed(Math.max(0, performance.now() - anchor.current)); if (!document.hidden && navigator.onLine !== false) void control.refresh(); };
    const clock = setInterval(() => setElapsed(Math.max(0, performance.now() - anchor.current)), 5_000);
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    control.start();
    if (initialAge > SNAPSHOT_FRESH_MS) void control.refresh();
    return () => { mounted = false; control.stop(); clearInterval(clock); refresh.current = null; document.removeEventListener("visibilitychange", resume); window.removeEventListener("online", resume); };
  }, [initial.generatedAt]);
  if (status === "denied") return <div className="komu-panel p-8" role="alert"><h1 className="text-xl font-semibold">Access to monitoring is restricted.</h1><a href="/login" className="komu-btn komu-btn-secondary mt-5">Sign in again</a></div>;
  const now = snapshot.generatedAt + elapsed;
  const view = dashboardView(snapshot, now, readFailed);
  const heartbeatAt = snapshot.worker?.lastSeenAt ?? null;
  const cards = [
    { title: "Discord gateway", icon: WifiOff, state: view.workerState, scope: "Discord worker",
      detail: <>{view.workerState === "healthy" ? "Gateway ready." : view.workerState === "degraded" ? "Gateway not ready." : "No recent gateway status."}
        {heartbeatAt !== null && <> Last heartbeat <Time value={heartbeatAt} now={now} />.</>}</> },
    { title: "Database operations", icon: Database, state: view.database, scope: "Dashboard process", detail: "Stream database operations observed here." },
    { title: "Progression", icon: Workflow, state: "unknown" as const, scope: "Discord worker", detail: "Message and activity processing not observed." },
    { title: "Challenge payouts", icon: Coins, state: "unknown" as const, scope: "Discord worker", detail: "Reward transactions not observed here." },
    { title: "Stream polling", icon: Radio, state: view.polling, scope: "Dashboard process", detail: "Registered timers and completed cycles." },
    { title: "Challenge announcements", icon: BellRing, state: "unknown" as const, scope: "Discord worker", detail: "Completion delivery not observed here." },
  ];
  const counts = STATES.map(state => ({ state, count: cards.filter(c => c.state === state).length }));
  const activePollers = view.pollers.filter(p => p.registered);
  return <div className="flex flex-col gap-6">
    <PageHeader eyebrow="Reliability & visibility" title="Monitoring" description="See what Komu has actually observed, and where visibility is still missing."
      actions={<button type="button" className="komu-btn komu-btn-secondary" disabled={status === "refreshing"} onClick={() => refresh.current?.()}><RefreshCw aria-hidden className={"h-4 w-4 " + (status === "refreshing" ? "animate-spin" : "")} />Refresh snapshot</button>} />
    <section className="relative overflow-hidden rounded-2xl border border-indigo-400/20 bg-gradient-to-br from-indigo-500/10 via-[var(--color-komu-surface)] to-violet-500/5 p-5 sm:p-7" aria-label="Monitoring coverage">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-4"><IconTile icon={Activity} tone={tones[view.state]} className="h-12 w-12" /><div>
          <div className="mb-2 flex flex-wrap items-center gap-2"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-indigo-300">Observed health</p><StateBadge state={view.state} /></div>
          <h2 className="text-xl font-semibold tracking-tight">Partial visibility. No assumed health.</h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-slate-400">Local dashboard observations and the Discord worker’s latest gateway heartbeat.</p>
        </div></div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 sm:gap-5 rounded-xl border border-white/5 bg-black/10 p-4">{counts.map(({ state, count }) => <div key={state}><p className="font-display text-2xl font-semibold tabular-nums">{count}</p><p className="mt-1 text-[11px] text-slate-400">{names[state]}</p></div>)}</div>
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-white/5 pt-4 text-xs text-slate-400">
        <span className="flex items-center gap-2"><ShieldCheck aria-hidden className="h-3.5 w-3.5 text-indigo-300" />Owner-only · Read-only observations</span>
        <span role="status" aria-live="polite">{status === "refreshing" ? "Refreshing…" : status === "unavailable" ? "Refresh unavailable · Current states are unknown" : status === "paused" ? "Automatic refresh paused" : view.expired ? "Snapshot expired · Refresh needed" : "Auto-refresh every 30 seconds"}</span>
        <span className="flex items-center gap-1.5"><Clock3 aria-hidden className="h-3.5 w-3.5" />Snapshot <time dateTime={new Date(snapshot.generatedAt).toISOString()}>{new Date(snapshot.generatedAt).toISOString().slice(11, 19)} UTC</time></span>
      </div>
    </section>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{cards.map(card => <article key={card.title} className="komu-panel flex flex-col gap-4 p-5">
      <div className="flex items-center justify-between gap-3"><IconTile icon={card.icon} tone={tones[card.state]} /><StateBadge state={card.state} /></div>
      <div><p className="komu-label text-[10px]">{card.scope}</p><h2 className="mt-1 text-sm font-semibold">{card.title}</h2><p className="mt-2 text-xs leading-5 text-slate-400">{card.detail}</p></div>
    </article>)}</div>
    <Panel title="Dashboard observations" icon={Activity} description="Recent operations only. Database observations cover stream work; REST observations are not gateway readiness." flush>
      <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-xs"><caption className="sr-only">Dashboard process operation health, freshness, and historical evidence</caption>
        <thead className="border-y border-[var(--color-komu-border)] bg-white/[0.02] text-[10px] uppercase tracking-wider text-slate-500"><tr>{["Operation", "State / freshness", "Last success", "Last failure", "Consecutive failures"].map(t => <th key={t} scope="col" className="px-5 py-3 font-medium">{t}</th>)}</tr></thead>
        <tbody className="divide-y divide-[var(--color-komu-border)]">{view.components.map(entry => <tr key={entry.component} className="align-top hover:bg-white/[0.015]">
          <th scope="row" className="px-5 py-4 font-medium text-slate-200">{COMPONENT_LABELS[entry.component]}<p className="mt-1 font-mono text-[10px] font-normal text-slate-500">{entry.component}</p></th>
          <td className="px-5 py-4"><StateBadge state={entry.state} /><div className="mt-2"><Freshness entry={entry} /></div><div className="mt-1 text-[10px] text-slate-500">Observed <Time value={entry.lastObservedAt} now={now} /></div></td>
          <td className="px-5 py-4 text-slate-400"><Time value={entry.lastSuccessAt} now={now} /></td>
          <td className="px-5 py-4 text-slate-400"><Time value={entry.lastFailureAt} now={now} />{entry.lastError ? <p className="mt-2 max-w-48 break-words font-mono text-[10px] text-slate-500">Last recorded: {entry.lastError}</p> : null}</td>
          <td className="px-5 py-4 font-mono text-slate-400">{entry.consecutiveFailures}</td>
        </tr>)}</tbody></table></div>
    </Panel>
    <div className="grid items-start gap-5 xl:grid-cols-[1.4fr_1fr]">
      <Panel title="Stream polling" icon={Radio} description="No new checks are triggered. A successful cycle does not verify every dependency.">
        {activePollers.length ? <div className="space-y-4">{activePollers.map(p => <div key={p.key} className="rounded-xl border border-[var(--color-komu-border)] bg-white/[0.015] p-4">
          <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-medium">{p.key === "youtube" ? "YouTube" : p.key === "fast" ? "Twitch & Kick" : "All providers"}</h3><StateBadge state={p.state} /></div>
          <p className="mt-2 text-xs text-slate-400"><Freshness entry={p} /> · Last completed <Time value={p.lastObservedAt} now={now} />{p.inFlight ? " · Cycle in progress" : ""}</p>
          <p className="mt-3 text-[10px] text-slate-500">{p.checked === null ? "Cycle result unavailable; previous counts are not shown." : "Last recorded cycle result"}</p><dl className="mt-3 grid grid-cols-3 gap-3 text-xs">{[["Checked", p.checked], ["Delivered", p.alerted], ["Failed", p.failed], ["Skipped", p.skipped], ["Unchanged", p.unchanged], ["Cadence", p.intervalMs ? Math.round(p.intervalMs / 1000) + "s" : "Unknown"]].map(([label, value]) => <div key={label}><dt className="text-[10px] text-slate-500">{label}</dt><dd className="mt-1 font-mono text-slate-300">{value ?? "—"}</dd></div>)}</dl>
        </div>)}</div> : <div className="rounded-xl border border-dashed border-[var(--color-komu-border-muted)] p-6"><Radio aria-hidden className="mb-3 h-5 w-5 text-slate-500" /><h3 className="text-sm font-medium">{view.pollers.some(p => p.reason === "SOURCE_UNAVAILABLE") ? "Poller observations unavailable" : "No timer observations in this process"}</h3><p className="mt-2 text-xs leading-5 text-slate-400">{view.pollers.some(p => p.reason === "SOURCE_UNAVAILABLE") ? "The latest read did not return timer observations. No health state is assumed." : "Polling may be disabled, externally scheduled, or running in another process. This is Unknown, not an outage."}</p></div>}
      </Panel>
      <Panel title="What these states mean" icon={ShieldCheck}>
        <dl className="space-y-4 text-xs">{[["Healthy", "Recent successful evidence for this operation."], ["Degraded", "A recent failed operation needs attention."], ["Unhealthy", "Repeated or critical failures in recent evidence."], ["Unknown", "No recent observation, an expired snapshot, or an unavailable source."]].map(([label, detail]) => <div key={label}><dt className="font-medium text-slate-200">{label}</dt><dd className="mt-1 leading-5 text-slate-400">{detail}</dd></div>)}</dl>
        <p className="mt-5 border-t border-[var(--color-komu-border)] pt-4 text-xs leading-5 text-slate-500">Quiet activity is normal. Historical failures stay visible after observations become stale. This page does not resend messages, retry payouts, or run health probes.</p>
      </Panel>
    </div>
  </div>;
}

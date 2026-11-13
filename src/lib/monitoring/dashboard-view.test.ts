import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MonitoringBoard } from "@/app/dashboard/monitoring/MonitoringBoard";
import { projectDashboardSnapshot } from "./dashboard-projection";
import { DASHBOARD_NAV } from "@/lib/dashboard/navigation";

const now = 1_800_000_000_000;
describe("monitoring page presentation without a live app", () => {
  it("renders honest worker/quiet-process states, accessible tables and refresh controls", () => {
    const html = renderToStaticMarkup(createElement(MonitoringBoard, { initial: projectDashboardSnapshot([], [], now) }));
    expect(html).toContain("Monitoring"); expect(html).toContain("Partial visibility");
    for (const label of ["Discord gateway", "Database operations", "Progression", "Challenge payouts", "Stream polling", "Challenge announcements", "Unknown", "Refresh snapshot", "No timer observations"]) expect(html).toContain(label);
    expect(html).not.toContain("Discord connected"); expect(html).toContain('<caption class="sr-only">'); expect(html).toContain('aria-live="polite"');
  });
  it("renders recent local evidence alongside unavailable worker coverage", () => {
    const snapshot = projectDashboardSnapshot([{ component: "discord.read", state: "healthy", stale: false, lastObservedAt: now, lastSuccessAt: now }], [], now);
    const html = renderToStaticMarkup(createElement(MonitoringBoard, { initial: snapshot }));
    expect(html).toContain("Healthy"); expect(html).toContain("Unknown"); expect(html).toContain("No recent gateway status.");
  });
  it("never renders stale incidents as current health and retains their safe history", () => {
    const snapshot = projectDashboardSnapshot([{ component: "discord.read", state: "unhealthy", stale: true, lastObservedAt: now - 400_000, lastFailureAt: now - 400_000, lastError: "DISCORD_AUTH_FAILED", consecutiveFailures: 3 }], [], now);
    const html = renderToStaticMarkup(createElement(MonitoringBoard, { initial: snapshot }));
    expect(html).toContain("Observation is stale"); expect(html).toContain("Last recorded: DISCORD_AUTH_FAILED");
  });
  it("registers Monitoring in the existing navigation", () => {
    expect(DASHBOARD_NAV.flatMap(section => section.items)).toContainEqual({ href: "/dashboard/monitoring", label: "Monitoring" });
  });
});

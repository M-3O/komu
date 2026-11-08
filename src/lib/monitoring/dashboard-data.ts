import "server-only";

import { getCurrentUser } from "@/lib/auth/current-user";
import { authorizeInstallationOwner } from "@/lib/auth/installation-owner";
import { health } from "./health";
import { getStreamPollerStatus } from "@/lib/streams/poller-runtime";
import { projectDashboardSnapshot } from "./dashboard-projection";
import type { DashboardSnapshot } from "./dashboard-model";

export type MonitoringRead = { ok: true; snapshot: DashboardSnapshot } | { ok: false; status: 401 | 403 | 503 };
/** The page and HTTP endpoint share this independently protected data boundary. */
export async function getMonitoringDashboard(): Promise<MonitoringRead> {
  try {
    const user = await getCurrentUser();
    if (!user) return { ok: false, status: 401 };
    const access = await authorizeInstallationOwner(user);
    if (!access.ok) return { ok: false, status: access.reason === "access_denied" ? 403 : 503 };
    let observations: unknown = null, pollers: unknown = null;
    try { observations = health.snapshot(); } catch { /* Unknown, never a fake success. */ }
    try { pollers = getStreamPollerStatus(); } catch { /* Other source can still be shown. */ }
    return { ok: true, snapshot: projectDashboardSnapshot(observations, pollers, Date.now()) };
  } catch {
    return { ok: false, status: 503 };
  }
}

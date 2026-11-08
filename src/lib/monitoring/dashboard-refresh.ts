import { fetchWithTimeout } from "@/lib/http/fetch-with-timeout";
import { REFRESH_MS, snapshotSchema, type DashboardSnapshot } from "./dashboard-model";

export const REQUEST_TIMEOUT_MS = 8_000;
export const MIN_REFRESH_MS = 10_000;
export const MAX_BACKOFF_MS = 300_000;
export type RefreshStatus = "ready" | "refreshing" | "unavailable" | "paused" | "denied";
export class MonitoringRequestError extends Error {
  constructor(readonly denied = false) { super("Monitoring unavailable."); }
}
/** Same-origin only, bounded response body, no redirects or raw response errors. */
export async function requestMonitoringSnapshot(signal: AbortSignal): Promise<DashboardSnapshot> {
  let response: Response;
  try {
    response = await fetchWithTimeout("/api/monitoring", { signal, credentials: "same-origin", cache: "no-store", redirect: "error", headers: { Accept: "application/json" } }, REQUEST_TIMEOUT_MS);
  } catch { throw new MonitoringRequestError(); }
  if (!response.ok) throw new MonitoringRequestError(response.status === 401 || response.status === 403);
  if (!response.headers.get("content-type")?.startsWith("application/json") || !response.body) throw new MonitoringRequestError();
  const reader = response.body.getReader();
  let bytes = 0, text = "";
  const decoder = new TextDecoder();
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > 64 * 1024) throw new MonitoringRequestError();
      text += decoder.decode(next.value, { stream: true });
    }
    text += decoder.decode();
    const result = snapshotSchema.safeParse(JSON.parse(text));
    if (!result.success) throw new MonitoringRequestError();
    return result.data;
  } catch { throw new MonitoringRequestError(); }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

/** One bounded request at a time; visibility/offline pauses, cooldown, backoff. */
export function createMonitoringRefresh(options: {
  request: (signal: AbortSignal) => Promise<DashboardSnapshot>;
  onSnapshot: (snapshot: DashboardSnapshot) => void;
  onStatus: (status: RefreshStatus) => void;
  active: () => boolean;
  now?: () => number;
}) {
  const now = options.now ?? (() => performance.now());
  let stopped = false, busy = false, failures = 0, lastAttempt = -Infinity;
  let nextAllowed = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  function schedule(delay: number) { clearTimeout(timer); if (!stopped) timer = setTimeout(() => { void refresh(); }, delay); }
  async function refresh() {
    if (stopped || busy) return;
    if (!options.active()) { options.onStatus("paused"); schedule(REFRESH_MS); return; }
    const remaining = Math.max(lastAttempt + MIN_REFRESH_MS, nextAllowed) - now();
    if (remaining > 0) { schedule(remaining); return; }
    busy = true; lastAttempt = now(); clearTimeout(timer);
    controller = new AbortController();
    const signal = controller.signal;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    options.onStatus("refreshing");
    try {
      const snapshot = await Promise.race([options.request(signal), new Promise<never>((_, reject) => {
        deadline = setTimeout(() => { controller?.abort(); reject(new MonitoringRequestError()); }, REQUEST_TIMEOUT_MS);
      })]);
      if (stopped) return;
      failures = 0; nextAllowed = now() + MIN_REFRESH_MS;
      options.onSnapshot(snapshot); options.onStatus("ready");
    } catch (error) {
      if (stopped) return;
      if (error instanceof MonitoringRequestError && error.denied) {
        stopped = true; options.onStatus("denied"); return;
      }
      failures = Math.min(failures + 1, 4);
      nextAllowed = now() + Math.min(MAX_BACKOFF_MS, REFRESH_MS * 2 ** failures);
      options.onStatus("unavailable");
    } finally {
      clearTimeout(deadline); busy = false;
      schedule(Math.max(REFRESH_MS, nextAllowed - now()));
    }
  }
  return {
    start() { schedule(REFRESH_MS); }, refresh,
    stop() { stopped = true; clearTimeout(timer); controller?.abort(); },
  };
}

import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getMonitoringDashboard } from "@/lib/monitoring/dashboard-data";
import { MonitoringBoard } from "./MonitoringBoard";

export const metadata = { title: "Monitoring" };
export default function MonitoringPage() {
  return <Suspense fallback={<div className="komu-panel animate-pulse p-8" role="status">Loading monitoring…</div>}><MonitoringContent /></Suspense>;
}
async function MonitoringContent() {
  const result = await getMonitoringDashboard();
  if (!result.ok) redirect("/login?error=" + (result.status === 503 ? "access_unavailable" : "access_denied"));
  return <MonitoringBoard key={result.snapshot.generatedAt} initial={result.snapshot} />;
}

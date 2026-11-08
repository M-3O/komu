import { getMonitoringDashboard } from "@/lib/monitoring/dashboard-data";

export async function GET(request: Request): Promise<Response> {
  const headers = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie", "X-Content-Type-Options": "nosniff" };
  // An authenticated browser's cookie is not sufficient for a cross-site caller.
  const origin = request.headers.get("origin");
  if (request.headers.get("sec-fetch-site") === "cross-site" || (origin && origin !== new URL(request.url).origin)) {
    return Response.json({ error: "Access denied." }, { status: 403, headers });
  }
  const result = await getMonitoringDashboard();
  if (!result.ok) return Response.json({ error: result.status === 503 ? "Monitoring unavailable." : "Access denied." }, { status: result.status, headers });
  return Response.json(result.snapshot, { headers });
}

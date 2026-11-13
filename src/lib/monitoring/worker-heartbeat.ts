import { prisma } from "@/lib/db";

const WORKER_ID = 1;

export function workerMonitoringEnabled() {
  const value = process.env.KOMU_WORKER_MONITORING_ENABLED;
  return value === "true" || value === "1";
}

export async function publishWorkerHeartbeat(ready: boolean) {
  const heartbeat = { ready, lastSeenAt: new Date() };
  await prisma.workerHeartbeat.upsert({
    where: { id: WORKER_ID },
    create: { id: WORKER_ID, ...heartbeat },
    update: heartbeat,
  });
}

export async function readWorkerHeartbeat() {
  if (!workerMonitoringEnabled()) return null;
  const heartbeat = await prisma.workerHeartbeat.findUnique({
    where: { id: WORKER_ID },
    select: { ready: true, lastSeenAt: true },
  }).catch(() => null);
  return heartbeat && { ready: heartbeat.ready, lastSeenAt: heartbeat.lastSeenAt.getTime() };
}

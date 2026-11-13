CREATE TABLE "worker_heartbeat" (
    "id" INTEGER PRIMARY KEY CHECK ("id" = 1),
    "ready" BOOLEAN NOT NULL,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL
);

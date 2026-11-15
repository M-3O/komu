-- CreateEnum
CREATE TYPE "StreamAlertStatus" AS ENUM ('PENDING', 'SENT', 'BLOCKED', 'UNCERTAIN', 'SKIPPED', 'EXPIRED');

-- AlterTable
ALTER TABLE "streaming_accounts" ADD COLUMN     "liveObservedAt" TIMESTAMP(3);
ALTER TABLE "streaming_accounts" ADD COLUMN     "liveCheckFailedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "xp_transactions" ADD COLUMN     "attendanceId" TEXT;

-- CreateTable
CREATE TABLE "stream_alert_deliveries" (
    "streamId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "status" "StreamAlertStatus" NOT NULL,
    "reason" TEXT,
    "channelId" TEXT,
    "roleId" TEXT,
    "lastAttemptAt" TIMESTAMP(3),
    "retryAt" TIMESTAMP(3),
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "claim" TEXT,
    "claimUntil" TIMESTAMP(3),

    CONSTRAINT "stream_alert_deliveries_pkey" PRIMARY KEY ("streamId")
);

-- CreateTable
CREATE TABLE "stream_webhook_events" (
    "provider" "StreamingProvider" NOT NULL,
    "eventId" TEXT NOT NULL,
    "broadcasterId" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "streamKey" TEXT,
    "title" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "stream_webhook_events_pkey" PRIMARY KEY ("provider","eventId")
);

-- CreateTable
CREATE TABLE "stream_webhook_health" (
    "provider" "StreamingProvider" NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL,
    "ready" BOOLEAN NOT NULL,

    CONSTRAINT "stream_webhook_health_pkey" PRIMARY KEY ("provider")
);

-- CreateTable
CREATE TABLE "youtube_broadcast_tracking" (
    "streamingAccountId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3),
    "nextCheckAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "youtube_broadcast_tracking_pkey" PRIMARY KEY ("streamingAccountId")
);

-- CreateTable
CREATE TABLE "youtube_search_budgets" (
    "day" TEXT NOT NULL,
    "calls" INTEGER NOT NULL,

    CONSTRAINT "youtube_search_budgets_pkey" PRIMARY KEY ("day")
);

-- CreateIndex
CREATE UNIQUE INDEX "stream_alert_deliveries_reference_key" ON "stream_alert_deliveries"("reference");

-- CreateIndex
CREATE INDEX "stream_alert_deliveries_status_retryAt_idx" ON "stream_alert_deliveries"("status", "retryAt");

-- CreateIndex
CREATE INDEX "stream_webhook_events_processedAt_receivedAt_idx" ON "stream_webhook_events"("processedAt", "receivedAt");

-- CreateIndex
CREATE INDEX "youtube_broadcast_tracking_nextCheckAt_idx" ON "youtube_broadcast_tracking"("nextCheckAt");

-- CreateIndex
CREATE UNIQUE INDEX "xp_transactions_attendanceId_key" ON "xp_transactions"("attendanceId");

-- AddForeignKey
ALTER TABLE "stream_alert_deliveries" ADD CONSTRAINT "stream_alert_deliveries_streamId_fkey" FOREIGN KEY ("streamId") REFERENCES "streams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "youtube_broadcast_tracking" ADD CONSTRAINT "youtube_broadcast_tracking_streamingAccountId_fkey" FOREIGN KEY ("streamingAccountId") REFERENCES "streaming_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "xp_transactions" ADD CONSTRAINT "xp_transactions_attendanceId_fkey" FOREIGN KEY ("attendanceId") REFERENCES "stream_attendance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

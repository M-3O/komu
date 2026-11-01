-- A challenge can publish completion announcements to a Discord channel.
--
-- Delivery is tracked per member on challenge_progress. The sent timestamp is
-- written only after Discord accepts the message; the claim timestamp and
-- opaque token normally prevent concurrent progression checks from posting the
-- same announcement twice, and make release/update ownership explicit. A send
-- that outlives the five-minute lease can still be reclaimed and posted again.

-- AlterTable
ALTER TABLE "challenges" ADD COLUMN "announcementChannelId" TEXT;

-- AlterTable
ALTER TABLE "challenge_progress" ADD COLUMN "announcementClaimedAt" TIMESTAMP(3),
ADD COLUMN "announcementClaimToken" TEXT,
ADD COLUMN "announcementSentAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "challenge_progress_guildId_memberId_announcementSentAt_idx" ON "challenge_progress"("guildId", "memberId", "announcementSentAt");

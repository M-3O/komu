-- Indexes for two hot reads flagged in the security review.
--
-- Stream lookups for the latest stream sort by startedAt within one account;
-- the unique key on (streamingAccountId, providerStreamId) cannot serve that
-- sort. Analytics sums XP transactions by guild and date with no source
-- predicate, so (guildId, source, createdAt) only serves the prefix.
--
-- The isGuildAdmin snapshot was written at login and never read. Removing it
-- stops it from silently drifting away from Discord's live permissions.

-- CreateIndex
CREATE INDEX "streams_streamingAccountId_startedAt_idx" ON "streams"("streamingAccountId", "startedAt");

-- CreateIndex
CREATE INDEX "xp_transactions_guildId_createdAt_idx" ON "xp_transactions"("guildId", "createdAt");

-- DropColumn
ALTER TABLE "discord_accounts" DROP COLUMN "isGuildAdmin";

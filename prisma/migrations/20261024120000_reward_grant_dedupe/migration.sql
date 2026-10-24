-- A claim key for one-shot automatic reward grants.
--
-- No backfill: existing rows keep a NULL key, and a NULL never collides. The
-- key only has to exist on the row that wins a race, and any pre-existing row
-- already makes the reward ineligible on its own.

-- AlterTable
ALTER TABLE "reward_grants" ADD COLUMN "dedupeKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "reward_grants_dedupeKey_key" ON "reward_grants"("dedupeKey");

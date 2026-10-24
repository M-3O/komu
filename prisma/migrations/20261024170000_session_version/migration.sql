-- Server-side session revocation.
--
-- Tokens are self-contained, so without a value on the row there is no way to
-- invalidate one before its seven-day expiry. Sign-out increments this; every
-- token signed with an older value is rejected on the next data read.

-- AlterTable
ALTER TABLE "users" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;

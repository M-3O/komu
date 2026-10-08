-- AlterTable
ALTER TABLE "guild_members" ADD COLUMN     "lastMessageHash" TEXT,
ADD COLUMN     "lastMessageRepeatCount" INTEGER NOT NULL DEFAULT 0;

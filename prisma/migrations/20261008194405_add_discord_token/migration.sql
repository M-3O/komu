-- AlterTable
ALTER TABLE "discord_accounts" ADD COLUMN     "accessToken" TEXT,
ADD COLUMN     "tokenExpiresAt" TIMESTAMP(3);

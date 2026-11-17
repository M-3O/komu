-- CreateEnum
CREATE TYPE "SeasonStatus" AS ENUM ('DRAFT', 'ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "SeasonPostStatus" AS ENUM ('PENDING', 'CLAIMED', 'UNCERTAIN', 'BLOCKED', 'SENT');

-- CreateEnum
CREATE TYPE "SeasonGrantStatus" AS ENUM ('PENDING', 'BLOCKED', 'GRANTED');

-- CreateTable
CREATE TABLE "seasons" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timeZone" TEXT NOT NULL,
    "goal" INTEGER NOT NULL,
    "roleId" TEXT NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "status" "SeasonStatus" NOT NULL DEFAULT 'DRAFT',

    CONSTRAINT "seasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "season_slots" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "videoId" TEXT,
    "nextVideoCheckAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "season_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "season_broadcasts" (
    "id" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,
    "streamId" TEXT NOT NULL,
    "supersededAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "postChannelId" TEXT,
    "postMessageId" TEXT,
    "fallbackReference" TEXT NOT NULL,
    "fallbackStatus" "SeasonPostStatus" NOT NULL DEFAULT 'PENDING',
    "fallbackClaim" TEXT,
    "fallbackAttemptAt" TIMESTAMP(3),
    "fallbackRetryAt" TIMESTAMP(3),

    CONSTRAINT "season_broadcasts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "season_check_ins" (
    "slotId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "checkedInAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "season_check_ins_pkey" PRIMARY KEY ("slotId","memberId")
);

-- CreateTable
CREATE TABLE "season_role_grants" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "status" "SeasonGrantStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claim" TEXT,
    "claimUntil" TIMESTAMP(3),
    "grantedAt" TIMESTAMP(3),

    CONSTRAINT "season_role_grants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "seasons_guildId_status_idx" ON "seasons"("guildId", "status");

-- CreateIndex
CREATE INDEX "season_slots_seasonId_scheduledAt_idx" ON "season_slots"("seasonId", "scheduledAt");

-- CreateIndex
CREATE INDEX "season_slots_nextVideoCheckAt_idx" ON "season_slots"("nextVideoCheckAt");

-- CreateIndex
CREATE UNIQUE INDEX "season_broadcasts_streamId_key" ON "season_broadcasts"("streamId");

-- CreateIndex
CREATE UNIQUE INDEX "season_broadcasts_postMessageId_key" ON "season_broadcasts"("postMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "season_broadcasts_fallbackReference_key" ON "season_broadcasts"("fallbackReference");

-- CreateIndex
CREATE INDEX "season_broadcasts_slotId_supersededAt_idx" ON "season_broadcasts"("slotId", "supersededAt");

-- CreateIndex
CREATE INDEX "season_check_ins_memberId_idx" ON "season_check_ins"("memberId");

-- CreateIndex
CREATE INDEX "season_role_grants_status_nextAttemptAt_idx" ON "season_role_grants"("status", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "season_role_grants_seasonId_memberId_key" ON "season_role_grants"("seasonId", "memberId");

-- AddForeignKey
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "season_slots" ADD CONSTRAINT "season_slots_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "seasons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "season_slots" ADD CONSTRAINT "season_slots_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "streaming_accounts"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "season_broadcasts" ADD CONSTRAINT "season_broadcasts_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "season_slots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "season_broadcasts" ADD CONSTRAINT "season_broadcasts_streamId_fkey" FOREIGN KEY ("streamId") REFERENCES "streams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "season_check_ins" ADD CONSTRAINT "season_check_ins_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "season_slots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "season_check_ins" ADD CONSTRAINT "season_check_ins_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "guild_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "season_role_grants" ADD CONSTRAINT "season_role_grants_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "seasons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "season_role_grants" ADD CONSTRAINT "season_role_grants_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "guild_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "seasons_one_active_per_guild" ON "seasons" ("guildId") WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "season_broadcasts_one_current_per_slot" ON "season_broadcasts" ("slotId") WHERE "supersededAt" IS NULL;

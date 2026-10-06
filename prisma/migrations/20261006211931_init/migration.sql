-- CreateEnum
CREATE TYPE "StreamingProvider" AS ENUM ('TWITCH', 'YOUTUBE', 'KICK');

-- CreateEnum
CREATE TYPE "AlertChannelType" AS ENUM ('CHANNEL');

-- CreateEnum
CREATE TYPE "AlertMessageMode" AS ENUM ('CUSTOM', 'DEFAULT');

-- CreateEnum
CREATE TYPE "XPSource" AS ENUM ('MESSAGE', 'STREAM_ATTENDANCE', 'WATCH_TIME', 'CHALLENGE', 'ACHIEVEMENT', 'REWARD', 'MANUAL');

-- CreateEnum
CREATE TYPE "ProgressionMetric" AS ENUM ('XP', 'LEVEL', 'MESSAGE_COUNT', 'STREAM_ATTENDANCE', 'WATCH_TIME_HOURS', 'MEMBER_AGE_DAYS');

-- CreateEnum
CREATE TYPE "RewardActionType" AS ENUM ('GIVE_XP', 'ADD_ROLE', 'REMOVE_ROLE', 'UNLOCK_ACHIEVEMENT', 'GIVEAWAY_ENTRY');

-- CreateEnum
CREATE TYPE "ChallengeRequirementType" AS ENUM ('MESSAGE_COUNT', 'STREAM_ATTENDANCE', 'WATCH_TIME_HOURS', 'LEVEL');

-- CreateEnum
CREATE TYPE "AchievementType" AS ENUM ('FIRST_STREAM', 'STREAM_ATTENDANCE_COUNT', 'WATCH_TIME_HOURS', 'MESSAGE_COUNT', 'MEMBER_AGE_DAYS', 'LEVEL');

-- CreateEnum
CREATE TYPE "ModerationRuleType" AS ENUM ('WORD_FILTER', 'SPAM', 'RAID_PROTECTION');

-- CreateEnum
CREATE TYPE "ModerationActionType" AS ENUM ('DELETE_MESSAGE', 'WARN', 'TIMEOUT', 'KICK', 'BAN');

-- CreateEnum
CREATE TYPE "ModerationActionTypeRecord" AS ENUM ('WORD_FILTER_DELETE', 'SPAM_TIMEOUT', 'RAID_TIMEOUT', 'MANUAL_WARN', 'MANUAL_TIMEOUT', 'MANUAL_KICK', 'MANUAL_BAN');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discord_accounts" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "avatarHash" TEXT,
    "isGuildAdmin" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "discord_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guilds" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "discordId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "iconHash" TEXT,
    "setupCompletedAt" TIMESTAMP(3),
    "ownerId" TEXT,
    "xpEnabled" BOOLEAN NOT NULL DEFAULT true,
    "xpMessageAmount" INTEGER NOT NULL DEFAULT 15,
    "xpMessageMinLength" INTEGER NOT NULL DEFAULT 3,
    "xpMessageCooldownSecs" INTEGER NOT NULL DEFAULT 60,
    "xpDailyCap" INTEGER NOT NULL DEFAULT 1000,

    CONSTRAINT "guilds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guild_members" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "guildId" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "nickname" TEXT,
    "avatarHash" TEXT,
    "roleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "xp" INTEGER NOT NULL DEFAULT 0,
    "level" INTEGER NOT NULL DEFAULT 1,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "streamAttendanceCount" INTEGER NOT NULL DEFAULT 0,
    "watchTimeMinutes" INTEGER NOT NULL DEFAULT 0,
    "lastXpMessageAt" TIMESTAMP(3),
    "xpToday" INTEGER NOT NULL DEFAULT 0,
    "xpTodayResetAt" TIMESTAMP(3),

    CONSTRAINT "guild_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "streaming_accounts" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "guildId" TEXT NOT NULL,
    "provider" "StreamingProvider" NOT NULL,
    "providerUserId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "displayName" TEXT,
    "avatarUrl" TEXT,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "disconnectedAt" TIMESTAMP(3),

    CONSTRAINT "streaming_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "streams" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "guildId" TEXT NOT NULL,
    "streamingAccountId" TEXT NOT NULL,
    "providerStreamId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "game" TEXT,
    "thumbnailUrl" TEXT,
    "viewerCount" INTEGER,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "alertSentAt" TIMESTAMP(3),

    CONSTRAINT "streams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stream_attendance" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "streamId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'REACTION',

    CONSTRAINT "stream_attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_configurations" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "guildId" TEXT NOT NULL,
    "streamingAccountId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "channelId" TEXT,
    "mentionRoleId" TEXT,
    "mentionEnabled" BOOLEAN NOT NULL DEFAULT false,
    "messageMode" "AlertMessageMode" NOT NULL DEFAULT 'DEFAULT',
    "customMessage" TEXT,
    "embedEnabled" BOOLEAN NOT NULL DEFAULT true,
    "embedColor" TEXT NOT NULL DEFAULT '#5865F2',
    "showThumbnail" BOOLEAN NOT NULL DEFAULT true,
    "showViewerCount" BOOLEAN NOT NULL DEFAULT true,
    "showGame" BOOLEAN NOT NULL DEFAULT true,
    "watchButtonEnabled" BOOLEAN NOT NULL DEFAULT true,
    "watchButtonLabel" TEXT NOT NULL DEFAULT 'Watch Now',

    CONSTRAINT "alert_configurations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "xp_transactions" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "guildId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "source" "XPSource" NOT NULL,
    "reason" TEXT,

    CONSTRAINT "xp_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_xp" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "memberId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "totalXp" INTEGER NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "xpToNextLevel" INTEGER NOT NULL,
    "lastLevelUpAt" TIMESTAMP(3),

    CONSTRAINT "member_xp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_rules" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "guildId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "metric" "ProgressionMetric" NOT NULL,
    "threshold" INTEGER NOT NULL,
    "roleId" TEXT NOT NULL,
    "roleName" TEXT NOT NULL,

    CONSTRAINT "role_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rewards" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "guildId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "conditionMetric" "ProgressionMetric" NOT NULL,
    "conditionThreshold" INTEGER NOT NULL,
    "repeatable" BOOLEAN NOT NULL DEFAULT false,
    "stopWhenComplete" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "rewards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reward_actions" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rewardId" TEXT NOT NULL,
    "type" "RewardActionType" NOT NULL,
    "xpAmount" INTEGER,
    "roleId" TEXT,
    "roleName" TEXT,
    "achievementId" TEXT,
    "giveawayId" TEXT,

    CONSTRAINT "reward_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reward_grants" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "guildId" TEXT NOT NULL,
    "rewardId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "progressValue" INTEGER NOT NULL,
    "manualGrantedByDiscordId" TEXT,

    CONSTRAINT "reward_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "challenges" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "guildId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "endsAt" TIMESTAMP(3),
    "xpReward" INTEGER NOT NULL DEFAULT 0,
    "rewardRoleId" TEXT,
    "rewardRoleName" TEXT,

    CONSTRAINT "challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "challenge_requirements" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "challengeId" TEXT NOT NULL,
    "type" "ChallengeRequirementType" NOT NULL,
    "threshold" INTEGER NOT NULL,
    "label" TEXT,

    CONSTRAINT "challenge_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "challenge_progress" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "guildId" TEXT NOT NULL,
    "challengeId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "progress" JSONB NOT NULL DEFAULT '{}',
    "completedAt" TIMESTAMP(3),
    "rewardGivenAt" TIMESTAMP(3),

    CONSTRAINT "challenge_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "achievements" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "guildId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "type" "AchievementType" NOT NULL,
    "threshold" INTEGER NOT NULL,
    "xpReward" INTEGER NOT NULL DEFAULT 0,
    "roleId" TEXT,
    "roleName" TEXT,

    CONSTRAINT "achievements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_achievements" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "guildId" TEXT NOT NULL,
    "achievementId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "unlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_achievements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "moderation_rules" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "guildId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ModerationRuleType" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "action" "ModerationActionType" NOT NULL DEFAULT 'DELETE_MESSAGE',
    "actionDurationMins" INTEGER,
    "blockedWords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "warnOnMatch" BOOLEAN NOT NULL DEFAULT false,
    "messageLimit" INTEGER,
    "windowSeconds" INTEGER,
    "joinThreshold" INTEGER,
    "joinWindowSeconds" INTEGER,
    "logChannelId" TEXT,

    CONSTRAINT "moderation_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "moderation_actions" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "guildId" TEXT NOT NULL,
    "type" "ModerationActionTypeRecord" NOT NULL,
    "targetMemberId" TEXT NOT NULL,
    "moderatorDiscordId" TEXT NOT NULL DEFAULT 'SYSTEM',
    "reason" TEXT,
    "durationMins" INTEGER,
    "warningClearedAt" TIMESTAMP(3),
    "ruleId" TEXT,

    CONSTRAINT "moderation_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "discord_accounts_userId_key" ON "discord_accounts"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "discord_accounts_discordId_key" ON "discord_accounts"("discordId");

-- CreateIndex
CREATE UNIQUE INDEX "guilds_discordId_key" ON "guilds"("discordId");

-- CreateIndex
CREATE INDEX "guild_members_guildId_xp_idx" ON "guild_members"("guildId", "xp");

-- CreateIndex
CREATE INDEX "guild_members_guildId_level_idx" ON "guild_members"("guildId", "level");

-- CreateIndex
CREATE INDEX "guild_members_guildId_messageCount_idx" ON "guild_members"("guildId", "messageCount");

-- CreateIndex
CREATE INDEX "guild_members_guildId_joinedAt_idx" ON "guild_members"("guildId", "joinedAt");

-- CreateIndex
CREATE UNIQUE INDEX "guild_members_guildId_discordId_key" ON "guild_members"("guildId", "discordId");

-- CreateIndex
CREATE INDEX "streaming_accounts_guildId_provider_idx" ON "streaming_accounts"("guildId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "streaming_accounts_guildId_provider_providerUserId_key" ON "streaming_accounts"("guildId", "provider", "providerUserId");

-- CreateIndex
CREATE INDEX "streams_guildId_startedAt_idx" ON "streams"("guildId", "startedAt");

-- CreateIndex
CREATE INDEX "streams_guildId_endedAt_idx" ON "streams"("guildId", "endedAt");

-- CreateIndex
CREATE UNIQUE INDEX "streams_streamingAccountId_providerStreamId_key" ON "streams"("streamingAccountId", "providerStreamId");

-- CreateIndex
CREATE INDEX "stream_attendance_memberId_createdAt_idx" ON "stream_attendance"("memberId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "stream_attendance_streamId_memberId_key" ON "stream_attendance"("streamId", "memberId");

-- CreateIndex
CREATE UNIQUE INDEX "alert_configurations_streamingAccountId_key" ON "alert_configurations"("streamingAccountId");

-- CreateIndex
CREATE INDEX "xp_transactions_memberId_createdAt_idx" ON "xp_transactions"("memberId", "createdAt");

-- CreateIndex
CREATE INDEX "xp_transactions_guildId_source_createdAt_idx" ON "xp_transactions"("guildId", "source", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "member_xp_memberId_key" ON "member_xp"("memberId");

-- CreateIndex
CREATE INDEX "role_rules_guildId_enabled_idx" ON "role_rules"("guildId", "enabled");

-- CreateIndex
CREATE INDEX "rewards_guildId_enabled_idx" ON "rewards"("guildId", "enabled");

-- CreateIndex
CREATE INDEX "reward_actions_rewardId_idx" ON "reward_actions"("rewardId");

-- CreateIndex
CREATE INDEX "reward_grants_rewardId_memberId_idx" ON "reward_grants"("rewardId", "memberId");

-- CreateIndex
CREATE INDEX "reward_grants_guildId_createdAt_idx" ON "reward_grants"("guildId", "createdAt");

-- CreateIndex
CREATE INDEX "challenges_guildId_enabled_idx" ON "challenges"("guildId", "enabled");

-- CreateIndex
CREATE INDEX "challenge_requirements_challengeId_idx" ON "challenge_requirements"("challengeId");

-- CreateIndex
CREATE INDEX "challenge_progress_guildId_completedAt_idx" ON "challenge_progress"("guildId", "completedAt");

-- CreateIndex
CREATE UNIQUE INDEX "challenge_progress_challengeId_memberId_key" ON "challenge_progress"("challengeId", "memberId");

-- CreateIndex
CREATE INDEX "achievements_guildId_enabled_idx" ON "achievements"("guildId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "achievements_guildId_name_key" ON "achievements"("guildId", "name");

-- CreateIndex
CREATE INDEX "member_achievements_memberId_unlockedAt_idx" ON "member_achievements"("memberId", "unlockedAt");

-- CreateIndex
CREATE UNIQUE INDEX "member_achievements_achievementId_memberId_key" ON "member_achievements"("achievementId", "memberId");

-- CreateIndex
CREATE INDEX "moderation_rules_guildId_enabled_idx" ON "moderation_rules"("guildId", "enabled");

-- CreateIndex
CREATE INDEX "moderation_actions_guildId_createdAt_idx" ON "moderation_actions"("guildId", "createdAt");

-- CreateIndex
CREATE INDEX "moderation_actions_targetMemberId_type_idx" ON "moderation_actions"("targetMemberId", "type");

-- AddForeignKey
ALTER TABLE "discord_accounts" ADD CONSTRAINT "discord_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guilds" ADD CONSTRAINT "guilds_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guild_members" ADD CONSTRAINT "guild_members_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "streaming_accounts" ADD CONSTRAINT "streaming_accounts_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "streams" ADD CONSTRAINT "streams_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "streams" ADD CONSTRAINT "streams_streamingAccountId_fkey" FOREIGN KEY ("streamingAccountId") REFERENCES "streaming_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stream_attendance" ADD CONSTRAINT "stream_attendance_streamId_fkey" FOREIGN KEY ("streamId") REFERENCES "streams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stream_attendance" ADD CONSTRAINT "stream_attendance_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "guild_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_configurations" ADD CONSTRAINT "alert_configurations_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_configurations" ADD CONSTRAINT "alert_configurations_streamingAccountId_fkey" FOREIGN KEY ("streamingAccountId") REFERENCES "streaming_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "xp_transactions" ADD CONSTRAINT "xp_transactions_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "guild_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_xp" ADD CONSTRAINT "member_xp_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "guild_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_rules" ADD CONSTRAINT "role_rules_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rewards" ADD CONSTRAINT "rewards_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_actions" ADD CONSTRAINT "reward_actions_rewardId_fkey" FOREIGN KEY ("rewardId") REFERENCES "rewards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_grants" ADD CONSTRAINT "reward_grants_rewardId_fkey" FOREIGN KEY ("rewardId") REFERENCES "rewards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_grants" ADD CONSTRAINT "reward_grants_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "guild_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenge_requirements" ADD CONSTRAINT "challenge_requirements_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "challenges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenge_progress" ADD CONSTRAINT "challenge_progress_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "challenges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenge_progress" ADD CONSTRAINT "challenge_progress_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "guild_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "achievements" ADD CONSTRAINT "achievements_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_achievements" ADD CONSTRAINT "member_achievements_achievementId_fkey" FOREIGN KEY ("achievementId") REFERENCES "achievements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_achievements" ADD CONSTRAINT "member_achievements_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "guild_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_rules" ADD CONSTRAINT "moderation_rules_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_targetMemberId_fkey" FOREIGN KEY ("targetMemberId") REFERENCES "guild_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "moderation_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

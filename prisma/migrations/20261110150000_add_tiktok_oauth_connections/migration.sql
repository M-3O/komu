-- Additive only. This migration is prepared for review and must not be
-- applied to production or test databases by this phase.

CREATE TABLE "tiktok_connections" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "guildId" TEXT NOT NULL,
    "connectedByUserId" TEXT,
    "openId" TEXT NOT NULL,
    "displayName" TEXT,
    "avatarUrl" TEXT,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "grantedScopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "videoNotificationsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "credentialsVersion" INTEGER NOT NULL DEFAULT 1,
    "refreshLeaseToken" TEXT,
    "refreshLeaseUntil" TIMESTAMP(3),
    "lastRefreshAttemptAt" TIMESTAMP(3),
    "disconnectLeaseToken" TEXT,
    "disconnectLeaseUntil" TIMESTAMP(3),
    "reauthorizationRequiredAt" TIMESTAMP(3),
    "disconnectedAt" TIMESTAMP(3),

    CONSTRAINT "tiktok_connections_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "tiktok_connections_access_token_encrypted_check"
      CHECK ("accessToken" IS NULL OR "accessToken" LIKE 'tiktok:v1:%' OR "accessToken" LIKE 'tiktok:v2:%'),
    CONSTRAINT "tiktok_connections_refresh_token_encrypted_check"
      CHECK ("refreshToken" IS NULL OR "refreshToken" LIKE 'tiktok:v1:%' OR "refreshToken" LIKE 'tiktok:v2:%'),
    CONSTRAINT "tiktok_connections_credentials_version_positive_check"
      CHECK ("credentialsVersion" > 0)
);

CREATE TABLE "tiktok_revocations" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "guildId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "sourceCredentialsVersion" INTEGER NOT NULL,
    "accessToken" TEXT NOT NULL,
    "retentionUntil" TIMESTAMP(3) NOT NULL,
    "leaseToken" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "lastErrorCategory" VARCHAR(64),

    CONSTRAINT "tiktok_revocations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "tiktok_revocations_access_token_encrypted_check"
      CHECK ("accessToken" LIKE 'tiktok:v1:%' OR "accessToken" LIKE 'tiktok:v2:%'),
    CONSTRAINT "tiktok_revocations_source_version_positive_check"
      CHECK ("sourceCredentialsVersion" > 0)
);

CREATE TABLE "tiktok_oauth_attempts" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "stateHash" VARCHAR(64) NOT NULL,
    "userId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "requestedScopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "redirectUri" VARCHAR(512) NOT NULL,

    CONSTRAINT "tiktok_oauth_attempts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tiktok_connections_guildId_key"
  ON "tiktok_connections"("guildId");
CREATE INDEX "tiktok_connections_guildId_disconnectedAt_idx"
  ON "tiktok_connections"("guildId", "disconnectedAt");
CREATE INDEX "tiktok_connections_refreshLeaseUntil_idx"
  ON "tiktok_connections"("refreshLeaseUntil");
CREATE INDEX "tiktok_connections_disconnectLeaseUntil_idx"
  ON "tiktok_connections"("disconnectLeaseUntil");
CREATE UNIQUE INDEX "tiktok_revocations_connectionId_sourceCredentialsVersion_key"
  ON "tiktok_revocations"("connectionId", "sourceCredentialsVersion");
CREATE INDEX "tiktok_revocations_retentionUntil_idx"
  ON "tiktok_revocations"("retentionUntil");
CREATE INDEX "tiktok_revocations_leaseUntil_idx"
  ON "tiktok_revocations"("leaseUntil");
CREATE UNIQUE INDEX "tiktok_oauth_attempts_stateHash_key"
  ON "tiktok_oauth_attempts"("stateHash");
CREATE INDEX "tiktok_oauth_attempts_expiresAt_idx"
  ON "tiktok_oauth_attempts"("expiresAt");
CREATE INDEX "tiktok_oauth_attempts_userId_guildId_expiresAt_idx"
  ON "tiktok_oauth_attempts"("userId", "guildId", "expiresAt");

ALTER TABLE "tiktok_connections"
  ADD CONSTRAINT "tiktok_connections_guildId_fkey"
  FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tiktok_connections"
  ADD CONSTRAINT "tiktok_connections_connectedByUserId_fkey"
  FOREIGN KEY ("connectedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tiktok_revocations"
  ADD CONSTRAINT "tiktok_revocations_guildId_fkey"
  FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tiktok_revocations"
  ADD CONSTRAINT "tiktok_revocations_connectionId_fkey"
  FOREIGN KEY ("connectionId") REFERENCES "tiktok_connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tiktok_oauth_attempts"
  ADD CONSTRAINT "tiktok_oauth_attempts_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tiktok_oauth_attempts"
  ADD CONSTRAINT "tiktok_oauth_attempts_guildId_fkey"
  FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

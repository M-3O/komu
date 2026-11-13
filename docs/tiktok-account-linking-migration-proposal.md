# TikTok account-linking migration proposal

**Status:** prepared additive migration, pending review. The migration is not
executed by this phase and no production or test database is touched.

## Why a migration is required

`StreamingProvider` currently contains only `TWITCH`, `YOUTUBE`, and `KICK`,
and `StreamingAccount` is the live-monitoring model. Adding TikTok to that
enum before a supported LIVE source exists would make the existing live-status
reader treat a linked account as a stream pipeline. That would blur the
important distinction between official account/video capabilities and the
currently unavailable TikTok LIVE capability.

TikTok account links should therefore have a separate model. This keeps
TikTok out of the live provider registry and makes the migration safe to roll
out before any LIVE implementation is approved.

## Proposed schema change

Add `TikTokConnection` and `TikTokOAuthAttempt` models related to `Guild` and
`User`. The reviewed shape is:

```prisma
model TikTokConnection {
  id        String   @id @default(cuid())
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  guildId String
  guild   Guild  @relation(fields: [guildId], references: [id], onDelete: Cascade)

  connectedByUserId String?
  connectedByUser   User? @relation("TikTokConnectionCreatedBy", fields: [connectedByUserId], references: [id], onDelete: SetNull)

  /// TikTok's app-scoped stable account identifier.
  openId          String
  displayName     String?
  avatarUrl       String?

  /// Values use provider-specific authenticated encryption. v1 remains
  /// readable during migration; approved key rotation writes tiktok:v2.
  accessToken          String?
  refreshToken         String?
  accessTokenExpiresAt  DateTime?
  refreshTokenExpiresAt DateTime?

  /// The scopes actually granted, not the scopes requested by KOMU.
  grantedScopes String[] @default([])

  videoNotificationsEnabled Boolean @default(false)
  credentialsVersion Int @default(1)
  refreshLeaseToken String?
  refreshLeaseUntil DateTime?
  lastRefreshAttemptAt DateTime?

  /// Set when TikTok reports revocation, expiry, or insufficient scope.
  reauthorizationRequiredAt DateTime?
  disconnectLeaseToken      String?
  disconnectLeaseUntil      DateTime?
  disconnectedAt            DateTime?

  /// One connection row per guild. Old access tokens live in the queue below.
  @@unique([guildId])
  @@map("tiktok_connections")
}

model TikTokRevocation {
  id        String   @id @default(cuid())
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  guildId String
  connectionId String
  sourceCredentialsVersion Int
  accessToken String
  retentionUntil DateTime
  leaseToken String?
  leaseUntil DateTime?
  lastAttemptAt DateTime?
  lastErrorCategory String?

  @@unique([connectionId, sourceCredentialsVersion])
  @@index([retentionUntil])
  @@map("tiktok_revocations")
}

model TikTokOAuthAttempt {
  id        String   @id @default(cuid())
  createdAt DateTime @default(now())
  expiresAt DateTime
  consumedAt DateTime?

  /// SHA-256 of a 32-byte random URL-safe state. The raw state is never stored.
  stateHash String @unique @db.VarChar(64)
  userId String
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  guildId String
  guild Guild @relation(fields: [guildId], references: [id], onDelete: Cascade)
  requestedScopes String[] @default([])
  redirectUri String @db.VarChar(512)

  @@index([expiresAt])
  @@index([userId, guildId, expiresAt])
  @@map("tiktok_oauth_attempts")
}
```

Add the matching `tiktokConnections TikTokConnection[]` relation to `Guild`.
Do not add `TIKTOK` to `StreamingProvider` in this migration.

The existing `Stream` table should not be reused for TikTok videos. A later,
separate migration should add a video cursor/deduplication record only if
official `video.list` support is approved and implemented.

## Migration acceptance checks

Before applying a future migration, reviewers should confirm:

1. Existing `StreamingAccount` rows and the `StreamingProvider` enum are
   unchanged.
2. Access and refresh tokens use the `tiktok:v1` provider-specific key
   derivation, are encrypted before persistence, and are never selected into
   client-facing DTOs. Database checks reject plaintext token values.
3. `openId` is used as the stable identity; only display name/avatar from
   `user.info.basic` are collected.
4. `grantedScopes` records the provider response, including partial consent;
   capability flags cannot enable a feature without the matching scope.
5. Refresh leases are considered uncertain after expiry; a credential-version
   compare-and-swap prevents an older response overwriting a newer rotation.
6. Confirmed disconnect clears credentials. Failed revocation moves only the
   encrypted access token needed for retry into `tiktok_revocations`, marks the
   connection disconnected, retains it for at most seven days, and is never
   reported as externally revoked. Relinking increments the source version and
   cannot delete the queue row. The queue's new foreign keys use `RESTRICT`,
   so destructive guild or connection deletion is blocked while a revocation
   record exists rather than silently discarding credentials that still need
   provider revocation.
7. OAuth attempts are eligible for deletion after expiry (including the
   opportunistic purge hook) and are one-time consumed by an atomic
   conditional update.
8. Disconnect, refresh, relink, and revocation maintenance use short database
   leases and credential-version CAS; no database transaction is held during a
   TikTok network call.
9. The migration is generated and reviewed against a disposable local
   database only; no production or test database is used by this phase.

The migration remains disabled by `TIKTOK_CONNECTION_STORAGE_READY = false`.
It must not be applied until the database owner approves this shape and the
TikTok app/scope review is complete.

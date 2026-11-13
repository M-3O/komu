import { randomBytes } from "node:crypto";

import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { decryptToken, encryptToken } from "@/lib/auth/token-crypto";
import {
  decryptTikTokToken,
  encryptTikTokToken,
  TIKTOK_TOKEN_PREFIX,
} from "@/lib/auth/provider-token-crypto";
import { prisma } from "@/lib/db";
import type { TikTokOAuthConfig } from "./config";
import {
  consumeTikTokOAuthAttempt,
  createTikTokOAuthAttempt,
} from "./oauth-attempts";
import {
  disconnectTikTokConnection,
  purgeExpiredTikTokRevocationCredentials,
  runTikTokRevocationMaintenance,
  saveTikTokConnection,
  TikTokConnectionBusyError,
} from "./connection-store";
import {
  prismaTikTokRefreshStore,
  refreshTikTokConnection,
  TikTokReauthorizationRequiredError,
} from "./token-refresh";
import type { TikTokTokenResponse } from "./oauth";

/**
 * This file is selected only by vitest.tiktok-postgres.config.ts. Its setup
 * file performs the explicit local-disposable target gate before this module
 * imports Prisma. Provider responses are always synthetic; no TikTok request
 * is made by this suite.
 */

const runId = `tiktok-pg-${Date.now()}-${randomBytes(5).toString("hex")}`;
const ownerId = `${runId}-owner`;
const guildId = `${runId}-guild`;
const testConfig: TikTokOAuthConfig = {
  clientKey: "synthetic-client-key",
  clientSecret: "synthetic-client-secret",
  redirectUri: "https://localhost.example.test/tiktok/callback",
};

let connectionSequence = 0;

function tokenResponse(input: Partial<TikTokTokenResponse> = {}): TikTokTokenResponse {
  return {
    access_token: "access-rotated",
    expires_in: 3600,
    refresh_token: "refresh-rotated",
    refresh_expires_in: 30 * 24 * 60 * 60,
    open_id: "open-id-1",
    scope: "user.info.basic",
    token_type: "Bearer",
    ...input,
  };
}

async function createConnection(
  input: {
    openId?: string;
    accessToken?: string;
    refreshToken?: string;
    accessTokenExpiresAt?: Date | null;
    refreshTokenExpiresAt?: Date | null;
    credentialsVersion?: number;
    refreshLeaseToken?: string | null;
    refreshLeaseUntil?: Date | null;
  } = {},
) {
  connectionSequence += 1;
  const now = new Date();
  return prisma.tikTokConnection.create({
    data: {
      guildId,
      openId: input.openId ?? `${runId}-open-${connectionSequence}`,
      displayName: "Synthetic creator",
      accessToken: input.accessToken === null
        ? null
        : encryptTikTokToken(input.accessToken ?? "access-old"),
      refreshToken: input.refreshToken === null
        ? null
        : encryptTikTokToken(input.refreshToken ?? "refresh-old"),
      accessTokenExpiresAt: input.accessTokenExpiresAt === undefined
        ? new Date(now.getTime() - 120_000)
        : input.accessTokenExpiresAt,
      refreshTokenExpiresAt: input.refreshTokenExpiresAt === undefined
        ? new Date(now.getTime() + 24 * 60 * 60 * 1000)
        : input.refreshTokenExpiresAt,
      grantedScopes: ["user.info.basic"],
      credentialsVersion: input.credentialsVersion ?? 1,
      refreshLeaseToken: input.refreshLeaseToken,
      refreshLeaseUntil: input.refreshLeaseUntil,
    },
  });
}

async function waitForLease(connectionId: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const row = await prisma.tikTokConnection.findUnique({
      where: { id: connectionId },
      select: { refreshLeaseToken: true },
    });
    if (row?.refreshLeaseToken) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("refresh lease was not acquired during the integration test");
}

async function waitForDisconnectLease(connectionId: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const row = await prisma.tikTokConnection.findUnique({
      where: { id: connectionId },
      select: { disconnectLeaseToken: true },
    });
    if (row?.disconnectLeaseToken) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("disconnect lease was not acquired during the integration test");
}

describe("TikTok PostgreSQL persistence and coordination", () => {
  beforeAll(async () => {
    await prisma.user.create({ data: { id: ownerId } });
    await prisma.guild.create({
      data: {
        id: guildId,
        discordId: `${runId}-discord-guild`,
        name: "Synthetic TikTok PostgreSQL test guild",
        ownerId,
      },
    });
  });

  afterEach(async () => {
    await prisma.tikTokOAuthAttempt.deleteMany({ where: { guildId } });
    await prisma.tikTokRevocation.deleteMany({ where: { guildId } });
    await prisma.tikTokConnection.deleteMany({ where: { guildId } });
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    await prisma.guild.deleteMany({ where: { id: guildId } });
    await prisma.user.deleteMany({ where: { id: ownerId } });
    await prisma.$disconnect();
  });

  it("allows exactly one concurrent callback to consume a shared OAuth state", async () => {
    const state = await createTikTokOAuthAttempt({
      userId: ownerId,
      guildId,
      requestedScopes: ["user.info.basic"],
      redirectUri: testConfig.redirectUri,
    });

    const results = await Promise.all([
      consumeTikTokOAuthAttempt({ state: state.state, userId: ownerId, guildId }),
      consumeTikTokOAuthAttempt({ state: state.state, userId: ownerId, guildId }),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(
      await consumeTikTokOAuthAttempt({
        state: state.state,
        userId: ownerId,
        guildId,
      }),
    ).toBeNull();

    const row = await prisma.tikTokOAuthAttempt.findUnique({
      where: { stateHash: state.stateHash },
      select: { consumedAt: true },
    });
    expect(row?.consumedAt).not.toBeNull();
  });

  it("rejects expired and mismatched OAuth attempts without consuming them", async () => {
    const expired = await createTikTokOAuthAttempt({
      userId: ownerId,
      guildId,
      requestedScopes: ["user.info.basic"],
      redirectUri: testConfig.redirectUri,
      now: Date.now() - 11 * 60 * 1000,
    });
    expect(
      await consumeTikTokOAuthAttempt({
        state: expired.state,
        userId: ownerId,
        guildId,
      }),
    ).toBeNull();

    const fresh = await createTikTokOAuthAttempt({
      userId: ownerId,
      guildId,
      requestedScopes: ["user.info.basic"],
      redirectUri: testConfig.redirectUri,
    });
    expect(
      await consumeTikTokOAuthAttempt({
        state: fresh.state,
        userId: `${ownerId}-wrong`,
        guildId,
      }),
    ).toBeNull();
    expect(
      await consumeTikTokOAuthAttempt({
        state: fresh.state,
        userId: ownerId,
        guildId,
      }),
    ).not.toBeNull();
  });

  it("single-flights simultaneous refreshes and persists one rotated credential set", async () => {
    const connection = await createConnection();
    let providerCalls = 0;
    let releaseProvider!: () => void;
    const providerHeld = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });

    const refresh = async (refreshToken: string) => {
      providerCalls += 1;
      expect(refreshToken).toBe("refresh-old");
      await providerHeld;
      return tokenResponse({ open_id: connection.openId });
    };

    const first = refreshTikTokConnection(connection.id, testConfig, {
      store: prismaTikTokRefreshStore,
      refresh,
    });
    await waitForLease(connection.id);
    const second = refreshTikTokConnection(connection.id, testConfig, {
      store: prismaTikTokRefreshStore,
      refresh,
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(providerCalls).toBe(1);
    releaseProvider();

    await expect(Promise.all([first, second])).resolves.toEqual([
      "access-rotated",
      "access-rotated",
    ]);
    expect(providerCalls).toBe(1);

    const row = await prisma.tikTokConnection.findUniqueOrThrow({
      where: { id: connection.id },
    });
    expect(row.credentialsVersion).toBe(2);
    expect(decryptTikTokToken(row.refreshToken!)).toBe("refresh-rotated");
    expect(row.refreshLeaseToken).toBeNull();
  });

  it("serializes disconnect against relink and preserves exactly one guild row", async () => {
    const connection = await createConnection({ openId: `${runId}-old-account` });
    let releaseRevoke!: () => void;
    let revokeStarted!: () => void;
    const revokeStartedPromise = new Promise<void>((resolve) => {
      revokeStarted = resolve;
    });
    const revokeGate = new Promise<void>((resolve) => {
      releaseRevoke = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        revokeStarted();
        await revokeGate;
        return new Response(null, { status: 200 });
      }),
    );

    const disconnect = disconnectTikTokConnection({
      guildId,
      connectionId: connection.id,
      config: testConfig,
    });
    await Promise.all([revokeStartedPromise, waitForDisconnectLease(connection.id)]);

    await expect(
      saveTikTokConnection({
        guildId,
        connectedByUserId: ownerId,
        token: tokenResponse({ open_id: `${runId}-new-account` }),
        userInfo: {
          open_id: `${runId}-new-account`,
          display_name: "New creator",
          avatar_url: null,
        },
      }),
    ).rejects.toBeInstanceOf(TikTokConnectionBusyError);

    releaseRevoke();
    await expect(disconnect).resolves.toEqual({ ok: true, revocationConfirmed: true });

    await saveTikTokConnection({
      guildId,
      connectedByUserId: ownerId,
      token: tokenResponse({ open_id: `${runId}-new-account` }),
      userInfo: {
        open_id: `${runId}-new-account`,
        display_name: "New creator",
        avatar_url: null,
      },
    });
    expect(await prisma.tikTokConnection.count({ where: { guildId } })).toBe(1);
  });

  it("does not let disconnect spend credentials while refresh owns the lease", async () => {
    const connection = await createConnection();
    let releaseRefresh!: () => void;
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    const refresh = refreshTikTokConnection(connection.id, testConfig, {
      store: prismaTikTokRefreshStore,
      refresh: async () => {
        await refreshGate;
        return tokenResponse({ open_id: connection.openId });
      },
    });
    await waitForLease(connection.id);

    await expect(
      disconnectTikTokConnection({ guildId, connectionId: connection.id, config: testConfig }),
    ).resolves.toEqual({ ok: false, error: "operation_in_progress" });
    releaseRefresh();
    await expect(refresh).resolves.toBe("access-rotated");
  });

  it("treats an expired lease as an uncertain crash and never retries the old token", async () => {
    const now = new Date();
    const connection = await createConnection({
      refreshLeaseToken: "crashed-process",
      refreshLeaseUntil: new Date(now.getTime() - 1_000),
    });
    const refresh = vi.fn(async () => tokenResponse({ open_id: connection.openId }));

    await expect(
      refreshTikTokConnection(connection.id, testConfig, {
        store: prismaTikTokRefreshStore,
        refresh,
      }),
    ).rejects.toBeInstanceOf(TikTokReauthorizationRequiredError);
    expect(refresh).not.toHaveBeenCalled();

    const row = await prisma.tikTokConnection.findUniqueOrThrow({
      where: { id: connection.id },
    });
    expect(row.reauthorizationRequiredAt).not.toBeNull();
    expect(row.refreshLeaseToken).toBeNull();
  });

  it("rejects stale credential-version writes without overwriting newer tokens", async () => {
    const connection = await createConnection({
      refreshLeaseToken: "stale-writer",
      refreshLeaseUntil: new Date(Date.now() + 30_000),
    });

    await prisma.tikTokConnection.update({
      where: { id: connection.id },
      data: {
        accessToken: encryptTikTokToken("access-newer"),
        refreshToken: encryptTikTokToken("refresh-newer"),
        credentialsVersion: 2,
        refreshLeaseToken: null,
        refreshLeaseUntil: null,
      },
    });

    const saved = await prismaTikTokRefreshStore.saveRotatedCredentials({
      id: connection.id,
      expectedVersion: 1,
      leaseToken: "stale-writer",
      accessToken: encryptTikTokToken("access-stale"),
      refreshToken: encryptTikTokToken("refresh-stale"),
      accessTokenExpiresAt: new Date(Date.now() + 60_000),
      refreshTokenExpiresAt: new Date(Date.now() + 60_000),
    });
    expect(saved).toBe(false);

    const row = await prisma.tikTokConnection.findUniqueOrThrow({
      where: { id: connection.id },
    });
    expect(row.credentialsVersion).toBe(2);
    expect(decryptTikTokToken(row.accessToken!)).toBe("access-newer");
    expect(decryptTikTokToken(row.refreshToken!)).toBe("refresh-newer");
  });

  it("rolls back transactions and enforces one connection per guild", async () => {
    const rollbackOpenId = `${runId}-rollback`;
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.tikTokConnection.create({
          data: { guildId, openId: rollbackOpenId },
        });
        throw new Error("synthetic rollback marker");
      }),
    ).rejects.toThrow("synthetic rollback marker");
    expect(
      await prisma.tikTokConnection.count({ where: { guildId, openId: rollbackOpenId } }),
    ).toBe(0);

    await createConnection({ openId: `${runId}-unique` });
    await expect(
      prisma.tikTokConnection.create({
        data: { guildId, openId: `${runId}-different-account` },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("blocks destructive deletion while a revocation still needs provider action", async () => {
    const connection = await createConnection();
    await prisma.tikTokRevocation.create({
      data: {
        guildId,
        connectionId: connection.id,
        sourceCredentialsVersion: connection.credentialsVersion,
        accessToken: encryptTikTokToken("access-needing-revocation"),
        retentionUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    await expect(
      prisma.tikTokConnection.delete({ where: { id: connection.id } }),
    ).rejects.toMatchObject({ code: "P2003" });
    await expect(
      prisma.guild.delete({ where: { id: guildId } }),
    ).rejects.toMatchObject({ code: "P2003" });

    await prisma.tikTokRevocation.deleteMany({
      where: { connectionId: connection.id },
    });
    await prisma.tikTokConnection.delete({ where: { id: connection.id } });
  });

  it("leases revocation retries across instances and cleanup leaves the new link intact", async () => {
    const connection = await createConnection({ openId: `${runId}-old-account` });
    await saveTikTokConnection({
      guildId,
      connectedByUserId: ownerId,
      token: tokenResponse({ open_id: `${runId}-new-account` }),
      userInfo: {
        open_id: `${runId}-new-account`,
        display_name: "New creator",
        avatar_url: null,
      },
    });
    const pending = await prisma.tikTokRevocation.findFirstOrThrow({
      where: { connectionId: connection.id },
    });
    const revoke = vi.fn(async () => undefined);

    const results = await Promise.all([
      runTikTokRevocationMaintenance(testConfig, { revoke }),
      runTikTokRevocationMaintenance(testConfig, { revoke }),
    ]);
    expect(revoke).toHaveBeenCalledOnce();
    expect(results.reduce((total, result) => total + result.revoked, 0)).toBe(1);
    expect(await prisma.tikTokRevocation.findUnique({ where: { id: pending.id } })).toBeNull();

    const active = await prisma.tikTokConnection.findUniqueOrThrow({ where: { guildId } });
    expect(active.openId).toBe(`${runId}-new-account`);

    await saveTikTokConnection({
      guildId,
      connectedByUserId: ownerId,
      token: tokenResponse({ open_id: `${runId}-newer-account` }),
      userInfo: {
        open_id: `${runId}-newer-account`,
        display_name: "Newer creator",
        avatar_url: null,
      },
    });
    const oldPending = await prisma.tikTokRevocation.findFirstOrThrow({ where: { connectionId: connection.id } });
    await purgeExpiredTikTokRevocationCredentials(new Date(oldPending.retentionUntil.getTime() + 1));
    expect(await prisma.tikTokConnection.findUniqueOrThrow({ where: { guildId } })).toMatchObject({
      openId: `${runId}-newer-account`,
    });
  });

  it("uses authenticated provider encryption and preserves Discord token compatibility", async () => {
    const tiktokCiphertext = encryptTikTokToken("tiktok-secret");
    expect(tiktokCiphertext.startsWith(`${TIKTOK_TOKEN_PREFIX}:`)).toBe(true);
    expect(tiktokCiphertext).not.toContain("tiktok-secret");
    expect(decryptTikTokToken(tiktokCiphertext)).toBe("tiktok-secret");
    expect(decryptTikTokToken(`${tiktokCiphertext.slice(0, -1)}x`)).toBeNull();
    expect(decryptToken(tiktokCiphertext)).toBeNull();

    const discordCiphertext = encryptToken("discord-secret");
    expect(decryptToken(discordCiphertext)).toBe("discord-secret");
    expect(decryptTikTokToken(discordCiphertext)).toBeNull();
    expect(decryptToken("legacy-discord-secret")).toBe("legacy-discord-secret");
  });

  it("does not claim revocation when TikTok rejects, then purges retained credentials", async () => {
    const connection = await createConnection();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: "synthetic-denial" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        })),
    );

    const result = await disconnectTikTokConnection({
      guildId,
      connectionId: connection.id,
      config: testConfig,
    });
    expect(result).toEqual({ ok: false, error: "revocation_unconfirmed" });

    const pending = await prisma.tikTokRevocation.findFirst({
      where: { connectionId: connection.id },
    });
    expect(pending?.retentionUntil).not.toBeNull();
    expect(
      (await prisma.tikTokConnection.findUniqueOrThrow({ where: { id: connection.id } }))
        .accessToken,
    ).toBeNull();

    const purged = await purgeExpiredTikTokRevocationCredentials(
      new Date(pending!.retentionUntil.getTime() + 1),
    );
    expect(purged).toBe(1);

    expect(
      await prisma.tikTokRevocation.findFirst({ where: { connectionId: connection.id } }),
    ).toBeNull();
  });

  it("clears credentials only after confirmed revocation", async () => {
    const connection = await createConnection();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));

    await expect(
      disconnectTikTokConnection({
        guildId,
        connectionId: connection.id,
        config: testConfig,
      }),
    ).resolves.toEqual({ ok: true, revocationConfirmed: true });

    const cleared = await prisma.tikTokConnection.findUniqueOrThrow({
      where: { id: connection.id },
    });
    expect(cleared.accessToken).toBeNull();
    expect(cleared.refreshToken).toBeNull();
    expect(cleared.disconnectedAt).not.toBeNull();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  connectionFindUnique: vi.fn(),
  connectionCreate: vi.fn(),
  connectionUpdateMany: vi.fn(),
  txConnectionFindUnique: vi.fn(),
  txConnectionCreate: vi.fn(),
  txConnectionUpdateMany: vi.fn(),
  revocationUpsert: vi.fn(),
  revocationFindFirst: vi.fn(),
  revocationDeleteMany: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    tikTokConnection: {
      findUnique: fake.connectionFindUnique,
      create: fake.connectionCreate,
      updateMany: fake.connectionUpdateMany,
    },
    tikTokRevocation: {
      findFirst: fake.revocationFindFirst,
      deleteMany: fake.revocationDeleteMany,
    },
    $transaction: fake.transaction,
  },
}));

import {
  disconnectTikTokConnection,
  saveTikTokConnection,
} from "./connection-store";
import { encryptTikTokToken } from "@/lib/auth/provider-token-crypto";

const CONFIG = {
  clientKey: "client-key",
  clientSecret: "client-secret",
  redirectUri: "https://komu.example/callback",
};

const TOKEN = {
  access_token: "access-token",
  expires_in: 7200,
  refresh_token: "refresh-token",
  refresh_expires_in: 15552000,
  open_id: "open-id",
  scope: "user.info.basic",
  token_type: "Bearer" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  fake.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
    callback({
      tikTokConnection: {
        findUnique: fake.txConnectionFindUnique,
        create: fake.txConnectionCreate,
        updateMany: fake.txConnectionUpdateMany,
      },
      tikTokRevocation: {
        upsert: fake.revocationUpsert,
        deleteMany: fake.revocationDeleteMany,
      },
    }),
  );
  process.env.AUTH_SECRET ??=
    "test-secret-value-that-is-at-least-32-characters-long";
  process.env.DATABASE_URL ??= "postgresql://localhost:5432/test";
  process.env.DISCORD_CLIENT_ID ??= "test-client-id";
  process.env.DISCORD_CLIENT_SECRET ??= "test-client-secret";
  process.env.DISCORD_BOT_TOKEN ??= "test-bot-token";
});

describe("TikTok connection persistence", () => {
  it("stores only basic-scope profile fields and encrypted credentials", async () => {
    await saveTikTokConnection({
      guildId: "guild-row",
      connectedByUserId: "owner-user",
      token: TOKEN,
      userInfo: {
        open_id: "open-id",
        display_name: "Creator",
        avatar_url: "https://example.invalid/avatar.png",
      },
    });

    const call = fake.txConnectionCreate.mock.calls[0]?.[0];
    expect(call.data.accessToken).toMatch(/^tiktok:v1:/);
    expect(call.data.refreshToken).toMatch(/^tiktok:v1:/);
    expect(call.data.displayName).toBe("Creator");
    expect(call.data).not.toHaveProperty("username");
    expect(call.data).not.toHaveProperty("profileUrl");
  });

  it("does not disconnect a connection outside the authorized guild", async () => {
    fake.connectionFindUnique.mockResolvedValue(null);

    await expect(
      disconnectTikTokConnection({
        guildId: "other-guild",
        connectionId: "connection-id",
        config: CONFIG,
      }),
    ).resolves.toEqual({ ok: false, error: "not_connected" });
    expect(fake.connectionUpdateMany).not.toHaveBeenCalled();
  });

  it("marks revocation pending instead of claiming success when TikTok rejects", async () => {
    fake.connectionFindUnique.mockResolvedValue({
      id: "connection-id",
      guildId: "guild-row",
      accessToken: encryptTikTokToken("access-token"),
      refreshToken: encryptTikTokToken("refresh-token"),
      credentialsVersion: 1,
      refreshLeaseToken: null,
      refreshLeaseUntil: null,
      disconnectLeaseToken: null,
      disconnectLeaseUntil: null,
      disconnectedAt: null,
    });
    fake.connectionUpdateMany.mockResolvedValue({ count: 1 });
    fake.txConnectionUpdateMany.mockResolvedValue({ count: 1 });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "invalid_token" }), { status: 400 })),
    );

    await expect(
      disconnectTikTokConnection({
        guildId: "guild-row",
        connectionId: "connection-id",
        config: CONFIG,
      }),
    ).resolves.toEqual({ ok: false, error: "revocation_unconfirmed" });

    expect(fake.revocationUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          accessToken: expect.stringMatching(/^tiktok:v1:/),
          retentionUntil: expect.any(Date),
        }),
      }),
    );
  });

  it("queues old credentials before a relink replaces the single guild row", async () => {
    fake.txConnectionFindUnique.mockResolvedValue({
      id: "connection-id",
      guildId: "guild-row",
      accessToken: encryptTikTokToken("old-access-token"),
      refreshToken: encryptTikTokToken("old-refresh-token"),
      credentialsVersion: 4,
      refreshLeaseToken: null,
      refreshLeaseUntil: null,
      disconnectLeaseToken: null,
      disconnectLeaseUntil: null,
      disconnectedAt: null,
    });
    fake.txConnectionUpdateMany.mockResolvedValue({ count: 1 });

    await saveTikTokConnection({
      guildId: "guild-row",
      connectedByUserId: "owner-user",
      token: { ...TOKEN, open_id: "new-open-id" },
      userInfo: { open_id: "new-open-id", display_name: "New", avatar_url: null },
    });

    expect(fake.revocationUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { connectionId_sourceCredentialsVersion: {
          connectionId: "connection-id", sourceCredentialsVersion: 4,
        } },
      }),
    );
    expect(fake.txConnectionUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ credentialsVersion: 4 }),
        data: expect.objectContaining({ credentialsVersion: { increment: 1 } }),
      }),
    );
  });

  it("does not finalize a disconnect after a relink wins the version race", async () => {
    fake.connectionFindUnique.mockResolvedValue({
      id: "connection-id",
      guildId: "guild-row",
      accessToken: encryptTikTokToken("access-token"),
      refreshToken: encryptTikTokToken("refresh-token"),
      credentialsVersion: 1,
      refreshLeaseToken: null,
      refreshLeaseUntil: null,
      disconnectLeaseToken: null,
      disconnectLeaseUntil: null,
      disconnectedAt: null,
    });
    fake.connectionUpdateMany.mockResolvedValue({ count: 1 });
    fake.txConnectionUpdateMany.mockResolvedValue({ count: 0 });
    fake.revocationDeleteMany.mockResolvedValue({ count: 0 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 200 })));

    await expect(
      disconnectTikTokConnection({
        guildId: "guild-row",
        connectionId: "connection-id",
        config: CONFIG,
      }),
    ).resolves.toEqual({ ok: false, error: "operation_in_progress" });
    expect(fake.revocationDeleteMany).toHaveBeenCalledWith({
      where: { connectionId: "connection-id", sourceCredentialsVersion: 1 },
    });
  });
});

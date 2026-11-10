import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

import { encryptTikTokToken } from "@/lib/auth/provider-token-crypto";
import {
  refreshTikTokConnection,
  TikTokReauthorizationRequiredError,
  type TikTokRefreshConnection,
  type TikTokRefreshStore,
} from "./token-refresh";

const CONFIG = {
  clientKey: "client-key",
  clientSecret: "client-secret",
  redirectUri: "https://komu.example/callback",
};

function makeStore(overrides: Partial<TikTokRefreshConnection> = {}) {
  const row: TikTokRefreshConnection = {
    id: "connection-id",
    openId: "open-id",
    accessToken: null,
    refreshToken: encryptTikTokToken("old-refresh"),
    accessTokenExpiresAt: new Date(0),
    refreshTokenExpiresAt: new Date(Date.now() + 86_400_000),
    credentialsVersion: 1,
    refreshLeaseToken: null,
    refreshLeaseUntil: null,
    disconnectLeaseToken: null,
    disconnectLeaseUntil: null,
    reauthorizationRequiredAt: null,
    disconnectedAt: null,
    ...overrides,
  };
  const calls = { refresh: 0, claims: 0, saves: 0, reauth: 0 };
  let saved = false;

  const store: TikTokRefreshStore = {
    async get() {
      return { ...row };
    },
    async claim(_id, version, leaseToken, leaseUntil) {
      calls.claims += 1;
      if (
        row.credentialsVersion !== version ||
        row.refreshLeaseToken ||
        row.reauthorizationRequiredAt ||
        row.disconnectLeaseToken
      ) {
        return false;
      }
      row.refreshLeaseToken = leaseToken;
      row.refreshLeaseUntil = leaseUntil;
      return true;
    },
    async markStaleLeaseUncertain(_id, version, leaseToken, now) {
      if (row.credentialsVersion !== version || row.refreshLeaseToken !== leaseToken) return false;
      row.reauthorizationRequiredAt = now;
      row.refreshLeaseToken = null;
      row.refreshLeaseUntil = null;
      calls.reauth += 1;
      return true;
    },
    async markReauthorizationRequired(_id, version, leaseToken, now) {
      if (row.credentialsVersion !== version || row.refreshLeaseToken !== leaseToken) return false;
      row.reauthorizationRequiredAt = now;
      row.refreshLeaseToken = null;
      row.refreshLeaseUntil = null;
      calls.reauth += 1;
      return true;
    },
    async markReauthorizationRequiredWithoutLease(_id, version, now) {
      if (row.credentialsVersion !== version) return false;
      row.reauthorizationRequiredAt = now;
      calls.reauth += 1;
      return true;
    },
    async saveRotatedCredentials(input) {
      calls.saves += 1;
      if (
        row.credentialsVersion !== input.expectedVersion ||
        row.refreshLeaseToken !== input.leaseToken
      ) {
        return false;
      }
      if (saved) return false;
      saved = true;
      row.accessToken = input.accessToken;
      row.refreshToken = input.refreshToken;
      row.accessTokenExpiresAt = input.accessTokenExpiresAt;
      row.refreshTokenExpiresAt = input.refreshTokenExpiresAt;
      row.credentialsVersion += 1;
      row.refreshLeaseToken = null;
      row.refreshLeaseUntil = null;
      return true;
    },
  };

  return { row, store, calls };
}

beforeEach(() => {
  process.env.AUTH_SECRET ??=
    "test-secret-value-that-is-at-least-32-characters-long";
  process.env.DATABASE_URL ??= "postgresql://localhost:5432/test";
  process.env.DISCORD_CLIENT_ID ??= "test-client-id";
  process.env.DISCORD_CLIENT_SECRET ??= "test-client-secret";
  process.env.DISCORD_BOT_TOKEN ??= "test-bot-token";
});

describe("TikTok refresh rotation coordination", () => {
  it("single-flights concurrent refreshes and stores the rotated token once", async () => {
    const { store, calls, row } = makeStore();
    let releaseProvider!: () => void;
    const providerGate = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    const refresh = vi.fn(async () => {
      calls.refresh += 1;
      await providerGate;
      return {
        access_token: "new-access",
        expires_in: 7200,
        refresh_token: "new-refresh",
        refresh_expires_in: 15552000,
        open_id: "open-id",
        scope: "user.info.basic",
        token_type: "Bearer" as const,
      };
    });
    const sleep = async () => new Promise<void>((resolve) => setTimeout(resolve, 1));

    const first = refreshTikTokConnection("connection-id", CONFIG, {
      store,
      refresh,
      sleep,
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = refreshTikTokConnection("connection-id", CONFIG, {
      store,
      refresh,
      sleep,
    });

    await new Promise((resolve) => setTimeout(resolve, 5));
    releaseProvider();
    await expect(first).resolves.toBe("new-access");
    await expect(second).resolves.toBe("new-access");

    expect(calls.refresh).toBe(1);
    expect(calls.claims).toBe(1);
    expect(calls.saves).toBe(1);
    expect(row.credentialsVersion).toBe(2);
    expect(row.refreshToken).toBeTruthy();
  });

  it("turns a failed or ambiguous rotation into reauthorization", async () => {
    const { store, calls } = makeStore();
    const refresh = vi.fn().mockRejectedValue(new Error("network failure"));

    await expect(
      refreshTikTokConnection("connection-id", CONFIG, {
        store,
        refresh,
        sleep: async () => undefined,
      }),
    ).rejects.toBeInstanceOf(TikTokReauthorizationRequiredError);

    expect(refresh).toHaveBeenCalledOnce();
    expect(calls.reauth).toBe(1);
    await expect(
      refreshTikTokConnection("connection-id", CONFIG, {
        store,
        refresh,
        sleep: async () => undefined,
      }),
    ).rejects.toBeInstanceOf(TikTokReauthorizationRequiredError);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("does not retry after a stale lease from a crashed process", async () => {
    const { store, calls } = makeStore({
      refreshLeaseToken: "stale-lease",
      refreshLeaseUntil: new Date(0),
    });
    const refresh = vi.fn();

    await expect(
      refreshTikTokConnection("connection-id", CONFIG, {
        store,
        refresh,
      }),
    ).rejects.toBeInstanceOf(TikTokReauthorizationRequiredError);

    expect(refresh).not.toHaveBeenCalled();
    expect(calls.reauth).toBe(1);
  });

  it("does not return a token from a CAS-losing reauthorized connection", async () => {
    const { store, row } = makeStore();
    const refresh = vi.fn(async () => {
      row.accessToken = encryptTikTokToken("newer-access");
      row.accessTokenExpiresAt = new Date(Date.now() + 3_600_000);
      row.credentialsVersion = 2;
      row.refreshLeaseToken = null;
      row.refreshLeaseUntil = null;
      row.reauthorizationRequiredAt = new Date();
      return {
        access_token: "stale-access",
        expires_in: 7200,
        refresh_token: "stale-refresh",
        refresh_expires_in: 15552000,
        open_id: "open-id",
        scope: "user.info.basic",
        token_type: "Bearer" as const,
      };
    });

    await expect(
      refreshTikTokConnection("connection-id", CONFIG, {
        store,
        refresh,
      }),
    ).rejects.toBeInstanceOf(TikTokReauthorizationRequiredError);
  });
});

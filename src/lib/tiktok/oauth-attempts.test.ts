import { beforeEach, describe, expect, it, vi } from "vitest";

interface FakeAttempt {
  id: string;
  stateHash: string;
  userId: string;
  guildId: string;
  requestedScopes: string[];
  redirectUri: string;
  expiresAt: Date;
  consumedAt: Date | null;
}

const fake = vi.hoisted(() => {
  const rows = new Map<string, FakeAttempt>();
  return {
    rows,
    prisma: {
      tikTokOAuthAttempt: {
        create: vi.fn(async ({ data }: { data: Omit<FakeAttempt, "id" | "consumedAt"> }) => {
          const row = { id: `attempt-${rows.size + 1}`, ...data, consumedAt: null };
          rows.set(data.stateHash, row);
          return row;
        }),
        findUnique: vi.fn(async ({ where }: { where: { stateHash: string } }) => {
          const row = rows.get(where.stateHash);
          return row ? { ...row } : null;
        }),
        updateMany: vi.fn(async ({
          where,
          data,
        }: {
          where: {
            id: string;
            userId: string;
            guildId: string;
            consumedAt: null;
            expiresAt: { gt: Date };
          };
          data: { consumedAt: Date };
        }) => {
          const row = [...rows.values()].find(
            (candidate) =>
              candidate.id === where.id &&
              candidate.userId === where.userId &&
              candidate.guildId === where.guildId &&
              candidate.consumedAt === null &&
              candidate.expiresAt > where.expiresAt.gt,
          );
          if (!row) return { count: 0 };
          row.consumedAt = data.consumedAt;
          return { count: 1 };
        }),
        deleteMany: vi.fn(async () => ({ count: 0 })),
      },
    },
  };
});

vi.mock("@/lib/db", () => ({ prisma: fake.prisma }));

import {
  consumeTikTokOAuthAttempt,
  createTikTokOAuthAttempt,
} from "./oauth-attempts";

describe("TikTok OAuth attempt persistence", () => {
  beforeEach(() => {
    fake.rows.clear();
    vi.clearAllMocks();
  });

  it("allows only one concurrent consumer to win the atomic write", async () => {
    const created = await createTikTokOAuthAttempt({
      userId: "owner-user",
      guildId: "guild-row",
      requestedScopes: ["user.info.basic"],
      redirectUri: "https://komu.example/callback",
      now: 1_000_000,
    });

    const [first, second] = await Promise.all([
      consumeTikTokOAuthAttempt({
        state: created.state,
        userId: "owner-user",
        guildId: "guild-row",
        now: new Date(1_000_001),
      }),
      consumeTikTokOAuthAttempt({
        state: created.state,
        userId: "owner-user",
        guildId: "guild-row",
        now: new Date(1_000_001),
      }),
    ]);

    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect([first, second].filter((value) => value === null)).toHaveLength(1);
  });

  it("rejects a different owner, guild, and an expired attempt", async () => {
    const created = await createTikTokOAuthAttempt({
      userId: "owner-user",
      guildId: "guild-row",
      requestedScopes: ["user.info.basic"],
      redirectUri: "https://komu.example/callback",
      now: 1_000_000,
    });

    await expect(
      consumeTikTokOAuthAttempt({
        state: created.state,
        userId: "other-user",
        guildId: "guild-row",
        now: new Date(1_000_001),
      }),
    ).resolves.toBeNull();

    await expect(
      consumeTikTokOAuthAttempt({
        state: created.state,
        userId: "owner-user",
        guildId: "guild-row",
        now: new Date(created.expiresAt.getTime() + 1),
      }),
    ).resolves.toBeNull();
  });
});

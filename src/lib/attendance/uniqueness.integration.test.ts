import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { recordStreamAttendance } from "@/lib/attendance/record-attendance";
import { unlockAchievementsForMember } from "@/lib/achievements/unlock";
import { prisma } from "@/lib/db";
import { cleanupMember, createTestMember, requireGuild } from "@/test/integration-helpers";

/**
 * One-shot guarantees against a real database (PRD sections 7.5, 7.10).
 *
 * Every one of these rests on a unique constraint rather than a check-then-
 * write, and every one of them was a silent-failure bug waiting to happen:
 * a duplicate that double-counts produces wrong numbers with no error at all.
 *
 * The inserts use `skipDuplicates`, so the returned row count is what decides
 * whether a payout happens. That is the property under test.
 */

const MEMBER_SEED = 800010;
const OTHER_SEED = 800011;
const ALERT_MESSAGE = "999000000000000010";

let guild: { id: string; name: string };

beforeEach(async () => {
  guild = await requireGuild();

  await prisma.stream.deleteMany({ where: { alertMessageId: ALERT_MESSAGE } });
  await prisma.achievement.deleteMany({
    where: { guildId: guild.id, name: "Integration: 1 stream" },
  });
});

afterEach(async () => {
  await prisma.streamAttendance.deleteMany({
    where: { stream: { alertMessageId: ALERT_MESSAGE } },
  });
  await prisma.achievement.deleteMany({
    where: { guildId: guild.id, name: "Integration: 1 stream" },
  });

  await cleanupMember(guild.id, MEMBER_SEED);
  await cleanupMember(guild.id, OTHER_SEED);
});

async function createAlertStream() {
  const account = await prisma.streamingAccount.findFirstOrThrow({
    where: { guildId: guild.id },
  });

  return prisma.stream.create({
    data: {
      guildId: guild.id,
      streamingAccountId: account.id,
      providerStreamId: `integration-${ALERT_MESSAGE}`,
      title: "Integration stream",
      startedAt: new Date(),
      alertSentAt: new Date(),
      alertMessageId: ALERT_MESSAGE,
    },
  });
}

/** The Discord member shape the services read: the snowflake is the only field. */
function discordMember(discordId: string) {
  return { id: discordId } as never;
}

/**
 * The guild's Discord snowflake.
 *
 * The attendance service is keyed on the Discord id while the database is
 * keyed on the internal id, and confusing the two is the bug these tests exist
 * to guard against.
 */
async function guildDiscordId(): Promise<string> {
  const row = await prisma.guild.findUniqueOrThrow({
    where: { id: guild.id },
    select: { discordId: true },
  });

  return row.discordId;
}

describe("stream attendance deduplication", () => {
  it("records once and refuses a second reaction for the same stream", async () => {
    const member = await createTestMember(guild.id, MEMBER_SEED);
    const stream = await createAlertStream();
    const discordId = await guildDiscordId();

    const react = () =>
      recordStreamAttendance({
        alertMessageId: ALERT_MESSAGE,
        discordUserId: member.discordId,
        guildDiscordId: discordId,
        username: "test",
      });

    const first = await react();
    expect(first.recorded).toBe(true);

    const second = await react();
    expect(second.recorded).toBe(false);
    expect(second.reason).toBe("ALREADY_RECORDED");

    const rows = await prisma.streamAttendance.count({
      where: { streamId: stream.id, memberId: member.id },
    });

    expect(rows).toBe(1);
  });

  it("increments the member counter exactly once", async () => {
    const member = await createTestMember(guild.id, MEMBER_SEED, {
      streamAttendanceCount: 0,
    });

    await createAlertStream();
    const discordId = await guildDiscordId();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await recordStreamAttendance({
        alertMessageId: ALERT_MESSAGE,
        discordUserId: member.discordId,
        guildDiscordId: discordId,
        username: "test",
      });
    }

    const after = await prisma.guildMember.findUniqueOrThrow({
      where: { id: member.id },
      select: { streamAttendanceCount: true },
    });

    expect(after.streamAttendanceCount).toBe(1);
  });

  it("ignores a reaction on a message that is not an alert", async () => {
    const member = await createTestMember(guild.id, MEMBER_SEED);

    const result = await recordStreamAttendance({
      alertMessageId: "111111111111111111",
      discordUserId: member.discordId,
      guildDiscordId: await guildDiscordId(),
      username: "test",
    });

    expect(result.recorded).toBe(false);
    expect(result.reason).toBe("NOT_AN_ALERT");
  });

  it("counts two members separately for one stream", async () => {
    const first = await createTestMember(guild.id, MEMBER_SEED);
    const second = await createTestMember(guild.id, OTHER_SEED);
    const stream = await createAlertStream();
    const discordId = await guildDiscordId();

    for (const member of [first, second]) {
      const result = await recordStreamAttendance({
        alertMessageId: ALERT_MESSAGE,
        discordUserId: member.discordId,
        guildDiscordId: discordId,
        username: "test",
      });

      expect(result.recorded).toBe(true);
    }

    const rows = await prisma.streamAttendance.count({ where: { streamId: stream.id } });
    expect(rows).toBe(2);
  });
});

describe("achievement unlocking pays out exactly once", () => {
  it("does not re-award on a second check", async () => {
    const member = await createTestMember(guild.id, MEMBER_SEED, {
      streamAttendanceCount: 5,
      xp: 0,
    });

    const achievement = await prisma.achievement.create({
      data: {
        guildId: guild.id,
        name: "Integration: 1 stream",
        description: "Attended a stream",
        icon: "🎟",
        type: "STREAM_ATTENDANCE_COUNT",
        threshold: 1,
        xpReward: 75,
      },
    });


    const first = await unlockAchievementsForMember({
      member: discordMember(member.discordId),
      guildId: guild.id,
    });

    expect(first.unlocked.map((entry) => entry.name)).toContain(achievement.name);

    const xpAfterFirst = await prisma.guildMember.findUniqueOrThrow({
      where: { id: member.id },
      select: { xp: true },
    });

    const second = await unlockAchievementsForMember({
      member: discordMember(member.discordId),
      guildId: guild.id,
    });

    expect(second.unlocked).toHaveLength(0);

    const xpAfterSecond = await prisma.guildMember.findUniqueOrThrow({
      where: { id: member.id },
      select: { xp: true },
    });

    // The whole point: the payout is tied to the insert succeeding, so a
    // second check cannot award again.
    expect(xpAfterSecond.xp).toBe(xpAfterFirst.xp);

    // Scoped to this achievement, because the seeded ones may also unlock for
    // the same member and are not what is under test here.
    const transactions = await prisma.xPTransaction.count({
      where: { memberId: member.id, reason: `Achievement unlocked: ${achievement.name}` },
    });

    expect(transactions).toBe(1);

    const unlocks = await prisma.memberAchievement.count({
      where: { memberId: member.id, achievementId: achievement.id },
    });

    expect(unlocks).toBe(1);
  });

  it("never unlocks a disabled achievement", async () => {
    const member = await createTestMember(guild.id, MEMBER_SEED, {
      streamAttendanceCount: 5,
      xp: 0,
    });

    await prisma.achievement.create({
      data: {
        guildId: guild.id,
        name: "Integration: 1 stream",
        description: "Attended a stream",
        icon: "🎟",
        type: "STREAM_ATTENDANCE_COUNT",
        threshold: 1,
        xpReward: 500,
        enabled: false,
      },
    });

    const result = await unlockAchievementsForMember({
      member: discordMember(member.discordId),
      guildId: guild.id,
    });

    // Scoped to this achievement: the seeded ones are outside this test, and
    // asserting on the whole list would fail for reasons unrelated to the
    // disabled flag.
    expect(result.unlocked.map((entry) => entry.name)).not.toContain(
      "Integration: 1 stream",
    );

    const rows = await prisma.memberAchievement.count({
      where: {
        memberId: member.id,
        achievement: { name: "Integration: 1 stream" },
      },
    });

    expect(rows).toBe(0);
  });

  it("keeps one member's unlock out of another's", async () => {
    const first = await createTestMember(guild.id, MEMBER_SEED, {
      streamAttendanceCount: 5,
      xp: 0,
    });
    const second = await createTestMember(guild.id, OTHER_SEED, {
      streamAttendanceCount: 0,
      xp: 0,
    });

    await prisma.achievement.create({
      data: {
        guildId: guild.id,
        name: "Integration: 1 stream",
        description: "Attended a stream",
        icon: "🎟",
        type: "STREAM_ATTENDANCE_COUNT",
        threshold: 1,
        xpReward: 50,
      },
    });

    await unlockAchievementsForMember({
      member: discordMember(first.discordId),
      guildId: guild.id,
    });

    // The second member has no attendance, so the first one's unlock must not
    // make this one eligible.
    const result = await unlockAchievementsForMember({
      member: discordMember(second.discordId),
      guildId: guild.id,
    });

    expect(result.unlocked.map((entry) => entry.name)).not.toContain(
      "Integration: 1 stream",
    );
  });
});

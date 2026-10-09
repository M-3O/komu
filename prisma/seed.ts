/**
 * Seeds one test Discord server so the dashboard has something to render
 * before the real OAuth flow connects an account.
 *
 * Idempotent: running it twice updates the same rows instead of duplicating
 * them, so it is safe to re-run at any time.
 *
 *   npm run db:seed
 */
import {
  AchievementType,
  PrismaClient,
  ProgressionMetric,
  RewardActionType,
  ChallengeRequirementType,
  ModerationRuleType,
  ModerationActionType,
  StreamingProvider,
  XPSource,
} from "@prisma/client";

const prisma = new PrismaClient();

// Placeholder snowflakes. Replaced with real ids during Discord OAuth setup.
const TEST_GUILD_DISCORD_ID = "000000000000000000";
const TEST_ADMIN_DISCORD_ID = "000000000000000001";

async function main() {
  console.log("Seeding Komu test data...");

  // --- Dashboard user + Discord identity --------------------------------
  // The Discord account is the stable key; the dashboard user is created
  // alongside it, or reused if one is already linked.
  const existingAdmin = await prisma.discordAccount.findUnique({
    where: { discordId: TEST_ADMIN_DISCORD_ID },
    include: { user: true },
  });

  const user = existingAdmin?.user ??
    (await prisma.user.create({ data: {} }));

  const admin = await prisma.discordAccount.upsert({
    where: { discordId: TEST_ADMIN_DISCORD_ID },
    update: { isGuildAdmin: true, userId: user.id },
    create: {
      userId: user.id,
      discordId: TEST_ADMIN_DISCORD_ID,
      username: "testadmin",
      isGuildAdmin: true,
    },
  });

  // --- The single Discord server ----------------------------------------
  const guild = await prisma.guild.upsert({
    where: { discordId: TEST_GUILD_DISCORD_ID },
    update: {},
    create: {
      discordId: TEST_GUILD_DISCORD_ID,
      name: "Komu Test Server",
      ownerId: user.id,
      setupCompletedAt: new Date(),
    },
  });
  console.log(`  guild       ${guild.name} (${guild.discordId})`);

  // --- A connected streaming account with alerts enabled ----------------
  const twitchAccount = await prisma.streamingAccount.upsert({
    where: {
      guildId_provider_providerUserId: {
        guildId: guild.id,
        provider: StreamingProvider.TWITCH,
        providerUserId: "testcreator",
      },
    },
    update: {},
    create: {
      guildId: guild.id,
      provider: StreamingProvider.TWITCH,
      providerUserId: "testcreator",
      username: "testcreator",
      displayName: "Test Creator",
    },
  });

  await prisma.alertConfiguration.upsert({
    where: { streamingAccountId: twitchAccount.id },
    update: {},
    create: {
      streamingAccountId: twitchAccount.id,
      guildId: guild.id,
      enabled: true,
      channelId: "000000000000000010",
      mentionEnabled: true,
      mentionRoleId: "000000000000000011",
      messageMode: "DEFAULT",
    },
  });
  console.log("  alert       Twitch alerts enabled for #streams");

  // --- Members with some XP history -------------------------------------
  const memberFixtures = [
    { discordId: "000000000000000101", username: "alpha", xp: 2450 },
    { discordId: "000000000000000102", username: "bravo", xp: 1310 },
    { discordId: "000000000000000103", username: "charlie", xp: 640 },
    { discordId: "000000000000000104", username: "delta", xp: 120 },
  ];

  for (const fixture of memberFixtures) {
    const member = await prisma.guildMember.upsert({
      where: {
        guildId_discordId: { guildId: guild.id, discordId: fixture.discordId },
      },
      update: {},
      create: {
        guildId: guild.id,
        discordId: fixture.discordId,
        username: fixture.username,
        xp: fixture.xp,
        level: levelForXp(fixture.xp),
      },
    });

    // A single opening transaction keeps the XP history non-empty so
    // leaderboards and analytics have something to read.
    const hasHistory = await prisma.xPTransaction.count({
      where: { memberId: member.id },
    });

    if (hasHistory === 0) {
      await prisma.xPTransaction.create({
        data: {
          guildId: guild.id,
          memberId: member.id,
          amount: fixture.xp,
          source: XPSource.MANUAL,
          reason: "Seed data",
        },
      });
    }

    await prisma.memberXP.upsert({
      where: { memberId: member.id },
      update: {},
      create: {
        memberId: member.id,
        guildId: guild.id,
        totalXp: fixture.xp,
        level: levelForXp(fixture.xp),
        xpToNextLevel: xpForLevel(levelForXp(fixture.xp) + 1) - fixture.xp,
      },
    });
  }
  console.log(`  members     ${memberFixtures.length} seeded`);

  // --- Role rules --------------------------------------------------------
  await prisma.roleRule.upsert({
    where: { id: "seed-role-rule-level-10" },
    update: {},
    create: {
      id: "seed-role-rule-level-10",
      guildId: guild.id,
      name: "Veteran (Level 10)",
      metric: ProgressionMetric.LEVEL,
      threshold: 10,
      roleId: "000000000000000020",
      roleName: "Veteran",
    },
  });

  await prisma.roleRule.upsert({
    where: { id: "seed-role-rule-og" },
    update: {},
    create: {
      id: "seed-role-rule-og",
      guildId: guild.id,
      name: "OG (30 days)",
      metric: ProgressionMetric.MEMBER_AGE_DAYS,
      threshold: 30,
      roleId: "000000000000000021",
      roleName: "OG",
    },
  });
  console.log("  roles       2 role rules");

  // --- A reward: watch 10 hours -> 500 XP + VIP role ---------------------
  const reward = await prisma.reward.upsert({
    where: { id: "seed-reward-watch-10h" },
    update: {},
    create: {
      id: "seed-reward-watch-10h",
      guildId: guild.id,
      name: "Stream Regular",
      description: "Attending ten streams.",
      // Attendance, not watch time. The plan's example for this reward was
      // "10 hours watched -> 500 XP and a VIP role", but watch time is never
      // collected, so a reward built on it could never be granted. Seeding one
      // would put a permanently unsatisfiable rule in every new database and
      // contradict the dashboard, which refuses to offer the metric.
      conditionMetric: ProgressionMetric.STREAM_ATTENDANCE,
      conditionThreshold: 10,
    },
  });

  await prisma.rewardAction.deleteMany({ where: { rewardId: reward.id } });
  await prisma.rewardAction.createMany({
    data: [
      { rewardId: reward.id, type: RewardActionType.GIVE_XP, xpAmount: 500 },
      {
        rewardId: reward.id,
        type: RewardActionType.ADD_ROLE,
        roleId: "000000000000000030",
        roleName: "VIP",
      },
    ],
  });
  console.log("  rewards     1 reward with 2 actions");

  // --- A challenge: attend 3 streams + send 20 messages -------------------
  const challenge = await prisma.challenge.upsert({
    where: { id: "seed-challenge-starter" },
    update: {},
    create: {
      id: "seed-challenge-starter",
      guildId: guild.id,
      name: "Community Starter",
      description: "Take part in your first few streams.",
      xpReward: 250,
      rewardRoleId: "000000000000000031",
      rewardRoleName: "Starter",
    },
  });

  await prisma.challengeRequirement.deleteMany({
    where: { challengeId: challenge.id },
  });
  await prisma.challengeRequirement.createMany({
    data: [
      {
        challengeId: challenge.id,
        type: ChallengeRequirementType.STREAM_ATTENDANCE,
        threshold: 3,
        label: "Attend 3 streams",
      },
      {
        challengeId: challenge.id,
        type: ChallengeRequirementType.MESSAGE_COUNT,
        threshold: 20,
        label: "Send 20 messages",
      },
    ],
  });
  console.log("  challenges  1 challenge with 2 requirements");

  // --- Achievements ------------------------------------------------------
  const achievementFixtures = [
    {
      name: "First Stream",
      description: "Attended your first stream.",
      icon: "🎉",
      type: AchievementType.FIRST_STREAM,
      threshold: 1,
    },
    {
      name: "Chatterbox",
      description: "Sent 1,000 messages.",
      icon: "💬",
      type: AchievementType.MESSAGE_COUNT,
      threshold: 1000,
    },
    {
      name: "OG Member",
      description: "Been in the server for 30 days.",
      icon: "🕰️",
      type: AchievementType.MEMBER_AGE_DAYS,
      threshold: 30,
    },
  ];

  for (const achievement of achievementFixtures) {
    await prisma.achievement.upsert({
      where: { guildId_name: { guildId: guild.id, name: achievement.name } },
      update: {},
      create: { guildId: guild.id, ...achievement, xpReward: 50 },
    });
  }
  console.log(`  achievements ${achievementFixtures.length} seeded`);

  // --- A moderation rule: word filter ------------------------------------
  await prisma.moderationRule.upsert({
    where: { id: "seed-mod-rule-word-filter" },
    update: {},
    create: {
      id: "seed-mod-rule-word-filter",
      guildId: guild.id,
      name: "Word filter",
      type: ModerationRuleType.WORD_FILTER,
      action: ModerationActionType.DELETE_MESSAGE,
      blockedWords: ["badword", "spam-link"],
      warnOnMatch: true,
    },
  });
  console.log("  moderation  1 word filter rule");

  console.log("\nSeed complete.");
  console.log(`  admin Discord id: ${admin.discordId}`);
}

/**
 * Level curve used by the seed so the sample data is self-consistent.
 * Mirrors `lib/levels/calculate-level.ts`, which is the real source of truth.
 * Duplicated here only to keep the seed free of app imports.
 */
function levelForXp(xp: number): number {
  let level = 1;
  while (xpForLevel(level + 1) <= xp && level < 1000) {
    level++;
  }
  return level;
}

function xpForLevel(level: number): number {
  return 100 * level * (level + 1) * 0.5;
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
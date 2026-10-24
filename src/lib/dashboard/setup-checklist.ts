import "server-only";

import { requireCurrentUser } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db";

/**
 * The setup checklist (PRD section 8).
 *
 * Reads the real state of the installation rather than showing a fixed list.
 * A static list tells a creator who has already connected their Twitch to go
 * and connect their Twitch, which trains people to ignore the page.
 *
 * Every step is derived from a field that already exists, so a step cannot
 * claim to be done when it is not.
 */

export interface SetupStep {
  id: string;
  label: string;
  detail: string;
  done: boolean;
  /** Where to go to finish it. Absent once the step is done. */
  href?: string;
}

export interface SetupChecklist {
  steps: SetupStep[];
  /** How many of the steps are done. */
  completed: number;
  total: number;
  /** True once every step is done. */
  finished: boolean;
}

export async function getSetupChecklist(): Promise<SetupChecklist> {
  await requireCurrentUser();

  const guild = await prisma.guild.findFirst({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      setupCompletedAt: true,
      xpEnabled: true,
      streamingAccounts: {
        where: { disconnectedAt: null },
        select: { id: true, provider: true, username: true },
      },
      alertConfigs: {
        // Only a connected account can post an alert. Counting the settings of
        // a disconnected account would report alerts as configured after the
        // creator removed the channel that made them work.
        where: { streamingAccount: { disconnectedAt: null } },
        select: {
          id: true,
          enabled: true,
          channelId: true,
          mentionRoleId: true,
          mentionEnabled: true,
        },
      },
      _count: { select: { roleRules: true } },
    },
  });

  // Nothing connected yet: the OAuth flow is the only step there is.
  if (!guild) {
    return {
      steps: [
        {
          id: "connect",
          label: "Sign in with Discord",
          detail: "Connect the server Komu will manage.",
          done: false,
        },
      ],
      completed: 0,
      total: 1,
      finished: false,
    };
  }

  const hasAccount = guild.streamingAccounts.length > 0;

  // `some` rather than `find`: one connected account may have alerts enabled
  // but no channel chosen yet, and it must not mask another that is complete.
  const alertsReady = guild.alertConfigs.some(
    (config) => config.enabled && Boolean(config.channelId),
  );

  const mentionReady = guild.alertConfigs.some(
    (config) =>
      config.enabled && config.mentionEnabled && Boolean(config.mentionRoleId),
  );

  const steps: SetupStep[] = [
    {
      id: "connect",
      label: "Connect your Discord server",
      detail: `Connected: ${guild.name}.`,
      done: true,
    },
    {
      id: "account",
      label: "Connect a streaming account",
      detail: hasAccount
        ? `Connected: ${guild.streamingAccounts
            .map((account) => `${account.provider} (${account.username})`)
            .join(", ")}.`
        : "Add Twitch, YouTube or Kick so Komu knows when you go live.",
      done: hasAccount,
      href: hasAccount ? undefined : "/dashboard/streams",
    },
    {
      id: "alert-channel",
      label: "Choose the alert channel",
      detail: alertsReady
        ? "Alerts will be posted there."
        : "Pick the channel live alerts should be posted in.",
      done: alertsReady,
      href: alertsReady ? undefined : "/dashboard/alerts",
    },
    {
      id: "alert-role",
      label: "Choose an alert role",
      detail: mentionReady
        ? "Mentions will use this role."
        : "Optional. Pick a role so stream alerts ping your community.",
      // Optional, so it never blocks completion. It is still tracked, because
      // a creator who wants it should be able to tell that they do not have it.
      done: mentionReady,
      href: mentionReady ? undefined : "/dashboard/alerts",
    },
    {
      id: "xp",
      label: "Enable XP for activity",
      detail: guild.xpEnabled
        ? "Members earn XP for taking part."
        : "Turn on XP so members earn it for messages and stream attendance.",
      done: guild.xpEnabled,
      href: guild.xpEnabled ? undefined : "/dashboard/xp",
    },
    {
      id: "roles",
      label: "Set up a role rule",
      detail:
        guild._count.roleRules > 0
          ? `${guild._count.roleRules} rule${guild._count.roleRules === 1 ? "" : "s"} configured.`
          : "Optional. Give members a role when they hit a milestone.",
      done: guild._count.roleRules > 0,
      href: guild._count.roleRules > 0 ? undefined : "/dashboard/roles",
    },
  ];

  const completed = steps.filter((step) => step.done).length;

  return {
    steps,
    completed,
    total: steps.length,
    finished: completed === steps.length,
  };
}
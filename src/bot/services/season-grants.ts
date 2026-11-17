import { randomUUID } from "node:crypto";
import { DiscordAPIError, Events, PermissionFlagsBits, type Client } from "discord.js";
import { prisma } from "@/lib/db";
import { lockSeason, MINUTE, seasonsEnabled } from "@/lib/seasons/lifecycle";
import { botWork, dispatchBotWork } from "../work-tracker";
import { addRoleToMember } from "./moderation";

const RETRY_INTERVALS = [30_000, 2 * MINUTE, 10 * MINUTE];

async function deliverSeasonRole(client: Client, grant: {
  roleId: string; guildDiscordId: string; memberDiscordId: string;
}) {
  try {
    const guild = client.guilds.cache.get(grant.guildDiscordId);
    if (!guild) return "GUILD_UNAVAILABLE";
    const member = await guild.members.fetch({ user: grant.memberDiscordId, force: true });
    const role = await guild.roles.fetch(grant.roleId, { force: true });
    if (!role) return "ROLE_DELETED";
    if (member.roles.cache.has(role.id)) return null;
    const bot = await guild.members.fetchMe({ force: true });
    if (role.managed || role.id === guild.id || !bot.permissions.has(PermissionFlagsBits.ManageRoles) ||
        bot.roles.highest.comparePositionTo(role) <= 0) return "ROLE_PERMISSIONS";
    const result = await addRoleToMember(member, role.id);
    if (result.ok) return null;
    if (result.code === "MEMBER_GONE") return "MEMBER_LEFT";
    if (result.code === "MISSING_PERMISSIONS" || result.code === "ROLE_HIERARCHY") return "ROLE_PERMISSIONS";
    if (result.code === "DISCORD_10011") return "ROLE_DELETED";
    return "TEMPORARY_FAILURE";
  } catch (error) {
    if (error instanceof DiscordAPIError) {
      if (error.code === 10007) return "MEMBER_LEFT";
      if (error.code === 10011) return "ROLE_DELETED";
      if (error.code === 50013 || error.code === 50001) return "ROLE_PERMISSIONS";
    }
    return "TEMPORARY_FAILURE";
  }
}

export async function processSeasonGrants(client: Client) {
  if (!client.isReady()) return;
  const now = new Date();
  const due = await prisma.seasonRoleGrant.findMany({
    where: { status: "PENDING", nextAttemptAt: { lte: now },
      OR: [{ claim: null }, { claimUntil: { lte: now } }] },
    orderBy: { nextAttemptAt: "asc" }, take: 20,
    select: { id: true, seasonId: true },
  });
  for (const candidate of due) {
    if (!botWork.isAccepting) break;
    const claim = randomUUID();
    const task = await prisma.$transaction(async (tx) => {
      await lockSeason(tx, candidate.seasonId);
      const now = new Date();
      const claimed = await tx.seasonRoleGrant.updateMany({
        where: { id: candidate.id, status: "PENDING", nextAttemptAt: { lte: now },
          OR: [{ claim: null }, { claimUntil: { lte: now } }] },
        data: { claim, claimUntil: new Date(+now + 2 * MINUTE) },
      });
      if (!claimed.count) return null;
      return tx.seasonRoleGrant.findUnique({
        where: { id: candidate.id },
        select: { id: true, roleId: true, attempts: true, member: { select: { discordId: true } },
          season: { select: { guild: { select: { discordId: true } } } } },
      });
    });
    if (!task) continue;
    const reason = await deliverSeasonRole(client, {
      roleId: task.roleId, guildDiscordId: task.season.guild.discordId, memberDiscordId: task.member.discordId,
    });
    const wait = reason === "TEMPORARY_FAILURE" || reason === "GUILD_UNAVAILABLE"
      ? RETRY_INTERVALS[task.attempts] : undefined;
    await prisma.seasonRoleGrant.updateMany({
      where: { id: task.id, claim },
      data: { status: !reason ? "GRANTED" : wait ? "PENDING" : "BLOCKED", reason,
        attempts: { increment: 1 }, claim: null, claimUntil: null,
        ...(wait ? { nextAttemptAt: new Date(Date.now() + wait) } : {}),
        ...(!reason ? { grantedAt: new Date() } : {}) },
    });
  }
}

export function registerSeasonGrantWorker(client: Client) {
  if (!seasonsEnabled()) return;
  client.once(Events.ClientReady, () => {
    const tick = () => {
      if (!botWork.isAccepting) return;
      dispatchBotWork(async () => {
        try {
          await processSeasonGrants(client);
        } finally {
          if (botWork.isAccepting) setTimeout(tick, 15_000).unref();
        }
      });
    };
    tick();
  });
}

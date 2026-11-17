"use server";

import { refresh } from "next/cache";
import { requireGuild } from "@/lib/dashboard/require-guild";
import { prisma } from "@/lib/db";
import { inspectGuildRole, guildHasRole } from "@/lib/discord/rest";
import { EARLY, LATE, createSeasonBroadcast, lockSeason, schedulesOverlap, seasonsEnabled } from "@/lib/seasons/lifecycle";
import { confirmSeasonStream } from "@/lib/seasons/pinned-streams";
import { parseSeasonDate } from "@/lib/seasons/schedule";
import { publishSeasonCheckIn } from "@/lib/seasons/posts";
import { reconcileLiveAlert, recordStreamObservation } from "@/lib/streams/alert-delivery";
import { getVideo } from "@/lib/youtube/client";
import { parseYouTubeBroadcastLink } from "@/lib/youtube/broadcast-tracking";

export interface SeasonFormState { error?: string; message?: string }

function field(form: FormData, key: string) {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function done(message: string): SeasonFormState {
  refresh();
  return { message };
}

async function seasonGuild() {
  if (!seasonsEnabled()) throw new Error("Seasons are unavailable.");
  return requireGuild("/dashboard/seasons");
}

export async function saveSeasonDraft(_state: SeasonFormState, form: FormData): Promise<SeasonFormState> {
  const guild = await seasonGuild();
  const id = field(form, "seasonId");
  const name = field(form, "name");
  const timeZone = field(form, "timeZone");
  const roleId = field(form, "roleId");
  const goal = Number(field(form, "goal"));
  const endsAt = timeZone.length <= 64 ? parseSeasonDate(field(form, "endsAt"), timeZone) : null;
  if (!name || name.length > 80 || !Number.isInteger(goal) || goal < 1 || goal > 24 ||
      !/^\d{15,22}$/.test(roleId) || !endsAt || +endsAt <= Date.now()) {
    return { error: "Enter a name, goal, role, and future end time. Choose a different time if it falls on a clock change." };
  }
  const data = { name, timeZone, roleId, goal, endsAt };
  if (!id) {
    await prisma.season.create({ data: { guildId: guild.id, ...data } });
  } else {
    const changed = await prisma.season.updateMany({ where: { id, guildId: guild.id, status: "DRAFT" }, data });
    if (!changed.count) return { error: "Only a draft can change these settings." };
  }
  return done("Draft saved.");
}

export async function saveSeasonSlot(_state: SeasonFormState, form: FormData): Promise<SeasonFormState> {
  const guild = await seasonGuild();
  const seasonId = field(form, "seasonId");
  const slotId = field(form, "slotId");
  const accountId = field(form, "accountId");
  const link = field(form, "videoLink");
  const snapshot = await prisma.season.findFirst({ where: { id: seasonId, guildId: guild.id, status: { in: ["DRAFT", "ACTIVE"] } } });
  if (!snapshot) return { error: "Season not found." };
  const scheduledAt = parseSeasonDate(field(form, "scheduledAt"), snapshot.timeZone);
  if (!scheduledAt || +scheduledAt <= Date.now() || +scheduledAt + LATE >= +snapshot.endsAt) {
    return { error: "Choose an unambiguous future time at least an hour before the season ends." };
  }
  const account = await prisma.streamingAccount.findFirst({ where: { id: accountId, guildId: guild.id, disconnectedAt: null } });
  if (!account) return { error: "Choose a connected account." };
  const videoId = link && link.length <= 2048 ? parseYouTubeBroadcastLink(link) : null;
  if (link) {
    if (account.provider !== "YOUTUBE" || !videoId) return { error: "A YouTube broadcast link requires a connected YouTube channel." };
    try {
      const [video] = await getVideo(videoId);
      if (video?.id !== videoId || video.snippet?.channelId !== account.providerUserId ||
          !video.liveStreamingDetails || video.liveStreamingDetails.actualEndTime) {
        return { error: "Choose an upcoming or live video from the selected channel." };
      }
    } catch {
      return { error: "YouTube could not verify the link. Try again shortly." };
    }
  }
  const error = await prisma.$transaction(async (tx) => {
    await lockSeason(tx, seasonId);
    const season = await tx.season.findFirst({
      where: { id: seasonId, guildId: guild.id, status: { in: ["DRAFT", "ACTIVE"] }, endsAt: { gt: new Date() } },
      include: { slots: { include: { broadcasts: { select: { id: true } } } } },
    });
    if (!season || season.timeZone !== snapshot.timeZone || +scheduledAt + LATE >= +season.endsAt) {
      return "The season changed. Refresh and check the dates.";
    }
    const existing = season.slots.find((slot) => slot.id === slotId);
    if (slotId && (!existing || existing.broadcasts.length)) return "A slot with a broadcast must be replaced through its broadcast controls.";
    if (!slotId && season.slots.length >= 24) return "A season can have up to 24 slots.";
    if (season.slots.some((slot) => slot.id !== slotId && !slot.cancelledAt && schedulesOverlap(slot, { accountId, scheduledAt }))) {
      return "This overlaps another slot’s match window for the same channel.";
    }
    if (videoId && season.slots.some((slot) => slot.id !== slotId && !slot.cancelledAt && slot.accountId === accountId && slot.videoId === videoId)) {
      return "That YouTube broadcast is already assigned to another slot.";
    }
    const data = { accountId, scheduledAt, videoId, cancelledAt: null,
      nextVideoCheckAt: videoId ? new Date(+scheduledAt - EARLY) : null };
    if (existing) await tx.seasonSlot.update({ where: { id: existing.id }, data });
    else await tx.seasonSlot.create({ data: { seasonId, ...data } });
    return null;
  });
  return error ? { error } : done("Stream slot saved.");
}

export async function manageSeason(_state: SeasonFormState, form: FormData): Promise<SeasonFormState> {
  const guild = await seasonGuild();
  const id = field(form, "seasonId");
  const intent = field(form, "intent");
  const seed = await prisma.season.findFirst({ where: { id, guildId: guild.id } });
  if (!seed) return { error: "Season not found." };
  if (intent === "activate") {
    if (seed.status !== "DRAFT") return { error: "Choose a draft to activate." };
    const roleError = await inspectGuildRole(guild.discordId, seed.roleId).catch(() => "Could not verify Discord roles.");
    if (roleError) return { error: roleError };
    const error = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM guilds WHERE id = ${guild.id} FOR UPDATE`;
      await lockSeason(tx, id);
      const now = new Date();
      const season = await tx.season.findFirst({ where: { id, guildId: guild.id, status: "DRAFT", roleId: seed.roleId },
        include: { slots: { where: { cancelledAt: null }, include: { account: true } } } });
      if (!season || +season.endsAt <= +now) return "Check the season settings and end date.";
      const slots = season.slots;
      if (slots.length < Math.max(2, season.goal) || slots.some((slot) =>
        slot.account.disconnectedAt || +slot.scheduledAt <= +now || +slot.scheduledAt + LATE >= +season.endsAt)) {
        return "Schedule enough future streams on connected accounts before activating.";
      }
      // Expired campaigns remain readable while freeing the active slot.
      await tx.season.updateMany({ where: { guildId: guild.id, status: "ACTIVE", endsAt: { lte: now } },
        data: { status: "CLOSED", closedAt: now } });
      const active = await tx.season.findFirst({ where: { guildId: guild.id, status: "ACTIVE" }, select: { id: true } });
      if (active) return "Close the current season before activating another.";
      await tx.season.update({ where: { id }, data: { status: "ACTIVE", activatedAt: now } });
      return null;
    });
    return error ? { error } : done("Season activated.");
  }
  if (intent === "close") {
    const closed = await prisma.season.updateMany({ where: { id, guildId: guild.id, status: "ACTIVE" },
      data: { status: "CLOSED", closedAt: new Date() } });
    return closed.count ? done("Season closed. Earned roles can still be delivered.") : { error: "This season is no longer active." };
  }
  if (intent === "duplicate") {
    const firstNew = parseSeasonDate(field(form, "firstSlot"), seed.timeZone);
    const slots = await prisma.seasonSlot.findMany({ where: { seasonId: id }, orderBy: { scheduledAt: "asc" } });
    if (!firstNew || +firstNew <= Date.now() || !slots.length) return { error: "Choose a future start time for the new season." };
    const offset = +firstNew - +slots[0].scheduledAt;
    await prisma.season.create({ data: {
      guildId: guild.id, name: seed.name, timeZone: seed.timeZone, goal: seed.goal, roleId: seed.roleId,
      endsAt: new Date(+seed.endsAt + offset),
      slots: { create: slots.map((slot) => ({ accountId: slot.accountId, scheduledAt: new Date(+slot.scheduledAt + offset) })) },
    } });
    return done("Copied as a new draft. Review the dates and any YouTube links before activating.");
  }
  return { error: "Choose a season action." };
}

export async function manageSeasonSlot(_state: SeasonFormState, form: FormData): Promise<SeasonFormState> {
  const guild = await seasonGuild();
  const id = field(form, "slotId");
  const intent = field(form, "intent");
  const slot = await prisma.seasonSlot.findFirst({
    where: { id, season: { guildId: guild.id, status: { in: ["DRAFT", "ACTIVE"] } } }, include: { season: true },
  });
  if (!slot) return { error: "Slot not found." };
  if (intent === "cancel") {
    const cancelled = await prisma.$transaction(async (tx) => {
      await lockSeason(tx, slot.seasonId);
      return tx.seasonSlot.updateMany({ where: { id, cancelledAt: null, broadcasts: { none: {} },
        season: { guildId: guild.id, status: { in: ["DRAFT", "ACTIVE"] } } },
        data: { cancelledAt: new Date(), nextVideoCheckAt: null } });
    });
    return cancelled.count ? done("Slot cancelled. Give it a new date to use it again.") : { error: "Only unused slots can be cancelled." };
  }
  if (intent !== "attach" || slot.season.status !== "ACTIVE") return { error: "Activate the season before attaching a broadcast." };
  const accountId = field(form, "accountId");
  const account = await prisma.streamingAccount.findFirst({
    where: { id: accountId, guildId: guild.id, disconnectedAt: null }, include: { alertConfig: true },
  });
  if (!account) return { error: "Choose a connected account." };
  const link = field(form, "videoLink");
  const videoId = link && link.length <= 2048 ? parseYouTubeBroadcastLink(link) : null;
  if (link && (!videoId || account.provider !== "YOUTUBE")) return { error: "Enter a valid YouTube broadcast link." };
  const observedAt = new Date();
  const live = await confirmSeasonStream(account, videoId ?? undefined).catch(() => null);
  if (!live) return { error: "No live broadcast was confirmed for that channel." };
  await recordStreamObservation(account.id, live, observedAt, undefined, { skipSeasonMatch: true });
  const error = await prisma.$transaction(async (tx) => {
    await lockSeason(tx, slot.seasonId);
    const now = new Date();
    const current = await tx.seasonSlot.findFirst({
      where: { id, season: { guildId: guild.id, status: "ACTIVE", endsAt: { gt: now } } },
      include: { broadcasts: { where: { supersededAt: null } } },
    });
    if (!current) return "This season has closed.";
    const stream = await tx.stream.findFirst({
      where: { guildId: guild.id, streamingAccountId: account.id, providerStreamId: live.providerStreamId,
        endedAt: null, streamingAccount: { disconnectedAt: null } },
      include: { seasonBroadcast: true },
    });
    if (!stream) return "The broadcast could not be confirmed as open.";
    if (stream.seasonBroadcast) {
      if (stream.seasonBroadcast.slotId === id && !stream.seasonBroadcast.supersededAt) return null;
      return "This broadcast has already been used for a season slot.";
    }
    await tx.seasonBroadcast.updateMany({ where: { slotId: id, supersededAt: null }, data: { supersededAt: now } });
    await createSeasonBroadcast(tx, id, stream.id);
    await tx.seasonSlot.update({ where: { id }, data: { cancelledAt: null, nextVideoCheckAt: null } });
    return null;
  });
  return error ? { error } : done("Broadcast attached. Komu will add check-in to the alert if it can.");
}

export async function recoverSeasonPost(_state: SeasonFormState, form: FormData): Promise<SeasonFormState> {
  const guild = await seasonGuild();
  const id = field(form, "broadcastId");
  const binding = await prisma.seasonBroadcast.findFirst({
    where: { id, supersededAt: null, slot: { season: { guildId: guild.id, status: "ACTIVE" } } },
    include: { stream: { include: { delivery: true } } },
  });
  if (!binding) return { error: "Choose an active broadcast." };
  try {
    if (binding.stream.delivery?.status === "UNCERTAIN") await reconcileLiveAlert(guild.id, binding.streamId);
    return done(await publishSeasonCheckIn(guild.id, id));
  } catch {
    return { error: "Komu could not check Discord. Try recovery again shortly." };
  }
}

export async function manageSeasonGrants(_state: SeasonFormState, form: FormData): Promise<SeasonFormState> {
  const guild = await seasonGuild();
  const id = field(form, "seasonId");
  const grantId = field(form, "grantId");
  const intent = field(form, "intent");
  if (intent === "retry") {
    const updated = await prisma.seasonRoleGrant.updateMany({
      where: { id: grantId, seasonId: id, season: { guildId: guild.id }, status: "BLOCKED", claim: null },
      data: { status: "PENDING", attempts: 0, reason: null, nextAttemptAt: new Date() },
    });
    return updated.count ? done("Role delivery queued.") : { error: "This grant is no longer blocked." };
  }
  if (intent !== "replace") return { error: "Choose a reward action." };
  const roleId = field(form, "roleId");
  if (!/^\d{15,22}$/.test(roleId)) return { error: "Choose a replacement role." };
  const season = await prisma.season.findFirst({ where: { id, guildId: guild.id } });
  if (!season || season.status === "DRAFT" || season.roleId === roleId) return { error: "Choose a season and a different role." };
  try {
    if (await guildHasRole(guild.discordId, season.roleId) !== false) return { error: "Komu must confirm the original role was deleted." };
    const invalid = await inspectGuildRole(guild.discordId, roleId);
    if (invalid) return { error: invalid };
  } catch {
    return { error: "Could not verify Discord roles." };
  }
  const replaced = await prisma.$transaction(async (tx) => {
    await lockSeason(tx, id);
    const now = new Date();
    const active = await tx.seasonRoleGrant.findFirst({ where: { seasonId: id, claimUntil: { gt: now } }, select: { id: true } });
    if (active) return false;
    const updated = await tx.season.updateMany({ where: { id, guildId: guild.id, roleId: season.roleId }, data: { roleId } });
    if (!updated.count) return false;
    await tx.seasonRoleGrant.updateMany({ where: { seasonId: id, status: { not: "GRANTED" } },
      data: { roleId, status: "PENDING", reason: null, attempts: 0, nextAttemptAt: now, claim: null, claimUntil: null } });
    return true;
  });
  return replaced ? done("Replacement role saved and undelivered grants queued.") : { error: "A grant is active or the role changed. Refresh and retry." };
}

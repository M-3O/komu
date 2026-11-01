import { randomUUID } from "node:crypto";

import {
  EmbedBuilder,
  type GuildMember,
  type SendableChannels,
} from "discord.js";

import { KOMU_COLOR } from "@/bot/constants";
import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logger";

/**
 * Publishing challenge completion announcements.
 *
 * This runs in the bot process because it needs a live Discord guild and
 * channel, and because challenge progress is recorded there. It is deliberately
 * not marked `server-only`: the standalone bot imports this module.
 *
 * A message is normally posted at most once per member per challenge. The
 * progress row is claimed with an opaque token before the Discord call, then
 * `announcementSentAt` is written only after Discord accepts the message. A
 * failed or unavailable channel therefore stays retryable instead of being
 * recorded as delivered.
 *
 * Discord and the database cannot participate in one transaction. A crash, a
 * timed-out send that Discord actually accepted, a send that outlives the claim
 * lease, or a database failure after a successful send can leave the row
 * retryable and produce a duplicate later.
 */

const log = createLogger("xp");

/** A claim older than this is treated as abandoned and may be retried. */
const CLAIM_LEASE_MS = 5 * 60 * 1000;

/** Bounded retries for the final database mark after a successful send. */
const SENT_MARK_ATTEMPTS = 3;
const SENT_MARK_RETRY_MS = 25;

export interface ChallengeAnnouncementResult {
  /** Challenges whose announcement Discord accepted. */
  announced: Array<{ challenge: string; messageId: string }>;
  /** Challenges whose announcement could not be delivered. */
  failed: Array<{ challenge: string; reason: string }>;
  /** Completed challenges with no announcement channel configured. */
  skippedNoChannel: number;
  /** Rows another check already claimed, or already delivered. */
  skippedDuplicate: number;
}

export interface ChallengeAnnouncementInput {
  member: GuildMember;
  guildId: string;
  /** Fixed clock for tests; production uses the current time per claim. */
  now?: Date;
}

interface AnnouncementChallenge {
  name: string;
  xpReward: number;
  rewardRoleName: string | null;
  announcementChannelId: string | null;
}

interface AnnouncementProgressRow {
  id: string;
  challenge: AnnouncementChallenge;
}

function emptyResult(): ChallengeAnnouncementResult {
  return {
    announced: [],
    failed: [],
    skippedNoChannel: 0,
    skippedDuplicate: 0,
  };
}

function errorReason(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown Discord error";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Build the Discord message for one completion.
 *
 * The member is mentioned explicitly, while `allowedMentions` permits only that
 * one user. That keeps a challenge name containing `@everyone` from turning
 * into a server-wide mention.
 */
export function buildChallengeCompletionAnnouncement(
  member: Pick<GuildMember, "id">,
  challenge: Pick<
    AnnouncementChallenge,
    "name" | "xpReward" | "rewardRoleName"
  >,
) {
  const rewardParts: string[] = [];

  if (challenge.xpReward > 0) {
    rewardParts.push(`${challenge.xpReward.toLocaleString()} XP`);
  }

  if (challenge.rewardRoleName) {
    rewardParts.push(`@${challenge.rewardRoleName}`);
  }

  const embed = new EmbedBuilder()
    .setColor(KOMU_COLOR)
    .setTitle("Challenge complete")
    .setDescription(`**${challenge.name}**`)
    .addFields({ name: "Status", value: "Completed", inline: true })
    .setFooter({ text: "Komu • Challenges" });

  if (rewardParts.length > 0) {
    embed.addFields({
      name: "Reward",
      value: rewardParts.join(" + "),
      inline: true,
    });
  }

  return {
    content: `<@${member.id}> completed **${challenge.name}**!`,
    embeds: [embed],
    allowedMentions: {
      // Disable automatic parsing; only the explicit member may be mentioned.
      // Discord rejects parse: ["users"] together with a non-empty users list.
      // This also prevents challenge text from pinging everyone, here, or roles.
      parse: [],
      users: [member.id],
    },
  };
}

/** Resolve a channel only when it is a text destination the bot can post to. */
async function resolveAnnouncementChannel(
  member: GuildMember,
  channelId: string,
): Promise<SendableChannels | null> {
  const channel = await member.guild.channels.fetch(channelId);

  if (!channel || !channel.isTextBased() || !("send" in channel)) {
    return null;
  }

  return channel;
}

/**
 * Release only the claim owned by this token.
 *
 * The token check is essential: another progression check may have legitimately
 * reclaimed this row after the lease expired.
 */
async function releaseClaim(id: string, claimToken: string): Promise<void> {
  try {
    await prisma.challengeProgress.updateMany({
      where: {
        id,
        announcementSentAt: null,
        announcementClaimToken: claimToken,
      },
      data: { announcementClaimedAt: null, announcementClaimToken: null },
    });
  } catch (error) {
    log.error("Could not release challenge announcement claim", {
      progressId: id,
      reason: errorReason(error),
    });
  }
}

/**
 * Mark a sent announcement with a small bounded retry for transient database
 * failures.
 *
 * A count of zero is not retried: it means the token no longer owns the row or
 * another check already recorded delivery. Retrying that would be wrong.
 */
async function markAnnouncementSent(
  id: string,
  claimToken: string,
  sentAt: Date,
): Promise<boolean> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= SENT_MARK_ATTEMPTS; attempt += 1) {
    try {
      const marked = await prisma.challengeProgress.updateMany({
        where: {
          id,
          announcementSentAt: null,
          announcementClaimToken: claimToken,
        },
        data: {
          announcementSentAt: sentAt,
          announcementClaimedAt: null,
          announcementClaimToken: null,
        },
      });

      return marked.count > 0;
    } catch (error) {
      lastError = error;

      if (attempt < SENT_MARK_ATTEMPTS) {
        await sleep(SENT_MARK_RETRY_MS);
      }
    }
  }

  throw lastError;
}

/**
 * Announce every completed challenge this member has not been announced for.
 *
 * Safe to call on every activity. The token-scoped claim update normally
 * prevents concurrent progression checks that load the same row from both
 * posting the message. A send that outlives the five-minute lease can still be
 * reclaimed and posted again; the claim is released on a failed send so a later
 * activity can retry.
 *
 * This function does not throw for database or Discord errors. A failure is
 * reported in `failed` so it cannot stop the rest of member progression.
 */
export async function announceChallengeCompletions(
  input: ChallengeAnnouncementInput,
): Promise<ChallengeAnnouncementResult> {
  const result = emptyResult();

  try {
    // `member.id` is a Discord snowflake; progress is keyed by the database row.
    const memberRow = await prisma.guildMember.findFirst({
      where: { guildId: input.guildId, discordId: input.member.id },
      select: { id: true },
    });

    if (!memberRow) return result;

    const rows: AnnouncementProgressRow[] =
      await prisma.challengeProgress.findMany({
        where: {
          guildId: input.guildId,
          memberId: memberRow.id,
          completedAt: { not: null },
          announcementSentAt: null,
        },
        select: {
          id: true,
          challenge: {
            select: {
              name: true,
              xpReward: true,
              rewardRoleName: true,
              announcementChannelId: true,
            },
          },
        },
      });

    for (const row of rows) {
      const channelId = row.challenge.announcementChannelId;

      if (!channelId) {
        result.skippedNoChannel += 1;
        continue;
      }

      // A claim is written before any Discord work. The token is the owner's
      // proof: an older claimant cannot release or overwrite a newer claim.
      // Timestamps are computed per row so a long pass does not create a claim
      // that is already outside its lease.
      const claimedAt = input.now ?? new Date();
      const staleBefore = new Date(claimedAt.getTime() - CLAIM_LEASE_MS);
      const claimToken = randomUUID();

      let claimed;

      try {
        claimed = await prisma.challengeProgress.updateMany({
          where: {
            id: row.id,
            announcementSentAt: null,
            OR: [
              { announcementClaimedAt: null },
              { announcementClaimedAt: { lt: staleBefore } },
            ],
          },
          data: {
            announcementClaimedAt: claimedAt,
            announcementClaimToken: claimToken,
          },
        });
      } catch (error) {
        const reason = errorReason(error);
        result.failed.push({ challenge: row.challenge.name, reason });
        log.error("Could not claim challenge announcement", {
          guildId: input.guildId,
          memberId: input.member.id,
          progressId: row.id,
          reason,
        });
        continue;
      }

      if (claimed.count === 0) {
        result.skippedDuplicate += 1;
        continue;
      }

      let channel: SendableChannels | null;

      try {
        channel = await resolveAnnouncementChannel(input.member, channelId);
      } catch (error) {
        const reason = errorReason(error);
        await releaseClaim(row.id, claimToken);
        result.failed.push({ challenge: row.challenge.name, reason });
        log.warn("Challenge announcement channel was unavailable", {
          guildId: input.guildId,
          channelId,
          reason,
        });
        continue;
      }

      if (!channel) {
        const reason =
          "The configured channel is no longer an available text channel.";
        await releaseClaim(row.id, claimToken);
        result.failed.push({ challenge: row.challenge.name, reason });
        log.warn("Challenge announcement channel was not sendable", {
          guildId: input.guildId,
          channelId,
        });
        continue;
      }

      let messageId: string;
      let sentAt: Date;

      try {
        const sent = await channel.send(
          buildChallengeCompletionAnnouncement(input.member, row.challenge),
        );
        messageId = sent.id;
        sentAt = input.now ?? new Date();
      } catch (error) {
        const reason = errorReason(error);
        await releaseClaim(row.id, claimToken);
        result.failed.push({ challenge: row.challenge.name, reason });
        log.warn("Challenge announcement failed", {
          guildId: input.guildId,
          channelId,
          challenge: row.challenge.name,
          reason,
        });
        continue;
      }

      let marked: boolean;

      try {
        marked = await markAnnouncementSent(row.id, claimToken, sentAt);
      } catch (error) {
        // The message is already in Discord. Leaving the claim and token in
        // place avoids an immediate duplicate retry; the stale lease allows
        // recovery later. That recovery can produce a duplicate, because the
        // external send and this database mark cannot be atomic.
        const reason = errorReason(error);
        result.failed.push({ challenge: row.challenge.name, reason });
        log.error("Challenge announcement sent but could not be recorded", {
          guildId: input.guildId,
          channelId,
          challenge: row.challenge.name,
          messageId,
          reason,
        });
        continue;
      }

      if (!marked) {
        // The message was accepted, but the token no longer owns the row or
        // another check already marked it. Do not report a second delivery.
        result.skippedDuplicate += 1;
        continue;
      }

      result.announced.push({ challenge: row.challenge.name, messageId });
      log.info("Challenge announcement posted", {
        guildId: input.guildId,
        channelId,
        challenge: row.challenge.name,
        messageId,
      });
    }
  } catch (error) {
    const reason = errorReason(error);
    result.failed.push({ challenge: "announcement check", reason });
    log.error("Challenge announcement check failed", {
      guildId: input.guildId,
      memberId: input.member.id,
      reason,
    });
  }

  return result;
}

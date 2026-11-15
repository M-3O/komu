import { prisma } from "@/lib/db";
import { requireGuild } from "@/lib/dashboard/require-guild";
import { RecoverAlertForm, YouTubeTrackingForm } from "./AlertRecoveryForms";
import { getDiscordDestinations } from "./discord-destinations";

const labels: Record<string, string> = {
  PENDING: "Pending", SENT: "Sent", BLOCKED: "Blocked", UNCERTAIN: "Delivery uncertain",
  SKIPPED: "Skipped", EXPIRED: "Expired", UNKNOWN: "Unknown",
};
const reasons: Record<string, string> = {
  ALERTS_OFF: "Alerts off",
  NO_CHANNEL: "No channel",
  DISCONNECTED: "Account disconnected",
  AUDIENCE_CHANGED: "Destination or role changed. Confirm the new audience before sending.",
  INVALID_MESSAGE: "The message exceeds Discord’s limits. Shorten the custom message.",
  STREAM_ENDED: "Broadcast ended",
  SEND_INTERRUPTED: "The send could not be confirmed.",
  DISCORD_OUTCOME_UNKNOWN: "Discord may already have posted this alert.",
  MESSAGE_RECOVERED: "Existing Discord post linked. Members whose reactions were missed can remove and re-add them.",
  DISCORD_50013: "Give Komu permission to send messages in the destination channel.",
  DISCORD_50001: "Give Komu access to the destination channel.",
  DISCORD_10003: "Choose an existing Discord channel.",
  DISCORD_50035: "Review the alert message and its settings.",
  HTTP_429: "Discord rate limited this alert.",
  HTTP_403: "Check Komu’s channel permissions.",
  HTTP_404: "Choose an existing Discord channel.",
};

const dateTime = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

function AlertTime({ date }: { date: Date }) {
  return <time dateTime={date.toISOString()}>{dateTime.format(date)} UTC</time>;
}

export async function RecentLiveAlerts({ now }: { now: number }) {
  const guild = await requireGuild("/dashboard/alerts");
  const [streams, youtube, providers, health, [channels, roles]] = await Promise.all([
    prisma.stream.findMany({
      where: { guildId: guild.id }, take: 20, orderBy: { startedAt: "desc" },
      include: { delivery: true, streamingAccount: { include: { alertConfig: true } } },
    }),
    prisma.streamingAccount.findMany({
      where: { guildId: guild.id, provider: "YOUTUBE", disconnectedAt: null },
      select: { id: true, username: true, youtubeTracking: true },
    }),
    prisma.streamingAccount.findMany({
      where: { guildId: guild.id, provider: { in: ["TWITCH", "KICK"] }, disconnectedAt: null },
      select: { provider: true }, distinct: ["provider"],
    }),
    prisma.streamWebhookHealth.findMany(),
    getDiscordDestinations(guild.discordId),
  ]);
  return (
    <section className="komu-panel space-y-5 p-5">
      <h2 className="text-lg font-semibold text-white">Recent live alerts</h2>
      {providers.map(({ provider }) => {
        const state = health.find((entry) => entry.provider === provider);
        const enabled = provider === "TWITCH" ? process.env.KOMU_TWITCH_WEBHOOK_ENABLED : process.env.KOMU_KICK_WEBHOOK_ENABLED;
        const ready = enabled === "true" && state?.ready && now - +state.checkedAt < 30 * 60_000;
        return <p key={provider} className="text-sm text-slate-300">{provider === "TWITCH" ? "Twitch" : "Kick"} detection {ready ? "· Webhooks and polling" : "· Polling fallback"}</p>;
      })}
      {youtube.map(({ id, username, youtubeTracking }) => (
        <div key={id} className="space-y-2">
          <p className="text-sm text-slate-300">{username}{youtubeTracking && !youtubeTracking.endedAt
            ? ` · Tracking ${youtubeTracking.videoId}` : ""}</p>
          <YouTubeTrackingForm accountId={id} />
        </div>
      ))}
      {!streams.length && <p className="text-sm text-slate-400">Detected broadcasts will appear here.</p>}
      <ul className="divide-y divide-slate-800">
        {streams.map((stream) => {
          const { delivery, streamingAccount: account } = stream;
          const stale = delivery?.claimUntil && +delivery.claimUntil <= now;
          const status = stale ? "UNCERTAIN" : delivery?.status ?? (stream.alertSentAt ? "SENT" : "UNKNOWN");
          const reason = stale ? "SEND_INTERRUPTED" : delivery?.reason;
          const config = account.alertConfig;
          const retryAt = delivery?.retryAt && +delivery.retryAt > now ? delivery.retryAt : null;
          const canSend = !stream.endedAt && !account.disconnectedAt && config?.enabled && config.channelId &&
            !retryAt && (status === "SKIPPED" || status === "BLOCKED");
          const roleId = config?.mentionEnabled ? config.mentionRoleId : null;
          const destination = channels.find((channel) => channel.id === delivery?.channelId);
          const currentChannel = channels.find((channel) => channel.id === config?.channelId);
          const currentRole = roles.find((role) => role.id === roleId);
          const providerUnknown = !stream.endedAt && (!account.liveObservedAt ||
            (account.liveCheckFailedAt && +account.liveCheckFailedAt > +account.liveObservedAt) ||
            now - +account.liveObservedAt > (account.provider === "YOUTUBE" ? 65 : 3) * 60_000);
          return (
            <li key={stream.id} className="grid gap-2 py-4">
              <p className="font-medium text-white">{stream.title || account.username} · {labels[status]}</p>
              <p className="text-sm text-slate-300">
                {account.username} · Detected <AlertTime date={stream.createdAt} />
                {delivery?.channelId && <> · Destination <a href={`https://discord.com/channels/${guild.discordId}/${delivery.channelId}`} className="underline">{destination ? `#${destination.name}` : delivery.channelId}</a></>}
                {providerUnknown && " · Live status unknown"}
              </p>
              {delivery?.lastAttemptAt && <p className="text-sm text-slate-400">Last attempt <AlertTime date={delivery.lastAttemptAt} /></p>}
              {retryAt && status !== "SKIPPED" && (
                <p className="text-sm text-slate-400">
                  {status === "PENDING" ? "Next attempt after" : "Manual retry available after"} <AlertTime date={retryAt} />
                </p>
              )}
              {reason && <p className="text-sm text-slate-300">{reasons[reason] ?? "Discord refused the alert. Check the destination and alert settings."}</p>}
              {status === "SENT" && stream.alertMessageId && delivery?.channelId && (
                <a className="text-sm text-indigo-300 underline" href={`https://discord.com/channels/${guild.discordId}/${delivery.channelId}/${stream.alertMessageId}`}>Open Discord post</a>
              )}
              {status === "UNCERTAIN" && <RecoverAlertForm streamId={stream.id} label="Check Discord" />}
              {canSend && config.channelId && (
                <div className="grid gap-2">
                  <p className="text-sm text-slate-300">Send to <a className="underline" href={`https://discord.com/channels/${guild.discordId}/${config.channelId}`}>{currentChannel ? `#${currentChannel.name}` : `channel ${config.channelId}`}</a>{roleId ? ` and mention ${currentRole ? `@${currentRole.name}` : `role ${roleId}`}` : " without a role mention"}.</p>
                  <RecoverAlertForm streamId={stream.id} channelId={config.channelId} roleId={roleId}
                    label={status === "SKIPPED" ? "Send for this stream" : "Retry"} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

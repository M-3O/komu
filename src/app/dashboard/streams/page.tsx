import { Suspense } from "react";

import { requireCurrentUser } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db";
import { availableProviders } from "@/lib/streams/registry";
import { getLiveStatuses } from "@/lib/streams/get-live-status";
import { ChannelManager } from "./ChannelManager";

export const metadata = { title: "Channels" };

/**
 * Streaming channels and their live status.
 *
 * Live status is fetched on this page rather than on the overview, because
 * every check is an external API call and the overview should stay cheap
 * (PRD section 14). The user can reload to re-check.
 */
export default function StreamsPage() {
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Channels</h1>
        <p className="text-sm text-[color:var(--color-komu-muted)]">
          Connect the streaming accounts Komu should watch.
        </p>
      </header>

      <Suspense fallback={<PanelSkeleton />}>
        <LiveStatusPanel />
      </Suspense>

      <Suspense fallback={<PanelSkeleton />}>
        <ChannelPanel />
      </Suspense>
    </div>
  );
}

async function LiveStatusPanel() {
  const user = await requireCurrentUser("/dashboard/streams");
  void user;

  const guild = await prisma.guild.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  if (!guild) {
    return (
      <p className="rounded-lg border border-[color:var(--color-komu-border)] p-4 text-sm text-[color:var(--color-komu-muted)]">
        Connect a Discord server first.
      </p>
    );
  }

  const statuses = await getLiveStatuses(guild.id);

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-semibold">Live status</h2>

      {statuses.length === 0 ? (
        <p className="rounded-lg border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] p-4 text-sm text-[color:var(--color-komu-muted)]">
          No channels connected yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {statuses.map((status) => (
            <li
              key={status.streamingAccountId}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] p-4"
            >
              <span
                aria-hidden
                className={
                  status.stream
                    ? "h-2.5 w-2.5 rounded-full bg-[color:var(--color-komu-live)]"
                    : "h-2.5 w-2.5 rounded-full bg-[color:var(--color-komu-muted)]"
                }
              />

              <span className="font-medium">
                {status.displayName ?? status.username}
              </span>

              {status.stream ? (
                <>
                  <span className="text-xs font-semibold tracking-wider text-[color:var(--color-komu-live)] uppercase">
                    Live
                  </span>
                  <span className="text-sm text-[color:var(--color-komu-muted)]">
                    {status.stream.title ?? "Untitled stream"}
                  </span>
                  {status.stream.game ? (
                    <span className="text-sm text-[color:var(--color-komu-muted)]">
                      · {status.stream.game}
                    </span>
                  ) : null}
                  {status.stream.viewerCount !== null ? (
                    <span className="text-sm text-[color:var(--color-komu-muted)]">
                      · {status.stream.viewerCount} watching
                    </span>
                  ) : null}
                  <a
                    href={status.stream.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="ml-auto rounded-md border border-[color:var(--color-komu-border)] px-3 py-1.5 text-sm hover:bg-[color:var(--color-komu-surface-raised)]"
                  >
                    Watch
                  </a>
                </>
              ) : status.error ? (
                <span className="text-sm text-[color:var(--color-komu-muted)]">
                  {status.error}
                </span>
              ) : (
                <span className="text-sm text-[color:var(--color-komu-muted)]">
                  Offline
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

async function ChannelPanel() {
  await requireCurrentUser("/dashboard/streams");

  const channels = await prisma.streamingAccount.findMany({
    where: { disconnectedAt: null },
    select: {
      id: true,
      provider: true,
      username: true,
      displayName: true,
    },
    orderBy: { createdAt: "asc" },
  });

  return (
    <ChannelManager
      channels={channels.map((channel) => ({
        id: channel.id,
        provider: channel.provider,
        username: channel.username,
        displayName: channel.displayName,
      }))}
      availableProviders={availableProviders()}
    />
  );
}

function PanelSkeleton() {
  return (
    <div
      className="h-24 animate-pulse rounded-lg border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)]"
      aria-hidden
    />
  );
}
import { Activity, Cable, Radio, RefreshCw, Route, Tv } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import {
  EmptyState,
  MetricCard,
  PageHeader,
} from "@/components/dashboard/ui";
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
    <div className="flex flex-col gap-7">
      <PageHeader
        eyebrow="Pipelines & routing"
        title="Channels & integrations"
        description="Connect the streaming accounts Komu should watch, and see which ones are live right now."
        actions={
          <>
            <Link href="/dashboard/alerts" className="komu-btn komu-btn-secondary">
              <Route className="h-4 w-4" />
              Alert routing
            </Link>
            <a href="/dashboard/streams" className="komu-btn komu-btn-primary">
              <RefreshCw className="h-4 w-4" />
              Refresh status
            </a>
          </>
        }
      />

      <Suspense fallback={<ChannelsSkeleton />}>
        <ChannelsWorkspace />
      </Suspense>
    </div>
  );
}

async function ChannelsWorkspace() {
  await requireCurrentUser("/dashboard/streams");

  const guild = await prisma.guild.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  if (!guild) {
    return (
      <EmptyState
        icon={Cable}
        title="Connect a Discord server first"
        description="Komu needs a server before it can watch streaming channels."
        action={
          <Link href="/setup" className="komu-btn komu-btn-primary">
            Open setup
          </Link>
        }
      />
    );
  }

  const [statuses, alertRoutes] = await Promise.all([
    getLiveStatuses(guild.id),
    prisma.alertConfiguration.findMany({
      where: { guildId: guild.id, enabled: true, channelId: { not: null } },
      select: { streamingAccountId: true },
    }),
  ]);

  const providers = availableProviders();
  const live = statuses.filter((status) => status.stream).length;
  const routeIds = alertRoutes.map((route) => route.streamingAccountId);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Connected accounts"
          value={statuses.length.toString()}
          hint="Watched every polling cycle"
          icon={Cable}
          tone="accent"
        />
        <MetricCard
          label="Live now"
          value={live.toString()}
          hint={live > 0 ? "Broadcast signal detected" : "No active broadcasts"}
          icon={Activity}
          tone={live > 0 ? "success" : "neutral"}
        />
        <MetricCard
          label="Alert routes"
          value={routeIds.length.toString()}
          hint="Enabled and pointed at a Discord channel"
          icon={Route}
          tone={routeIds.length > 0 ? "violet" : "warning"}
        />
        <MetricCard
          label="Providers ready"
          value={`${providers.length} / 3`}
          hint={providers.length === 0 ? "Add credentials to connect" : "Credentials present"}
          icon={Tv}
          tone={providers.length === 3 ? "success" : "warning"}
        />
      </div>

      <ChannelManager
        statuses={statuses.map((status) => ({
          id: status.streamingAccountId,
          provider: status.provider,
          username: status.username,
          displayName: status.displayName,
          avatarUrl: status.avatarUrl,
          stream: status.stream
            ? {
                title: status.stream.title,
                game: status.stream.game,
                thumbnail: status.stream.thumbnail,
                viewerCount: status.stream.viewerCount,
                url: status.stream.url,
                startedAt: status.stream.startedAt?.toISOString() ?? null,
              }
            : null,
          error: status.error,
        }))}
        availableProviders={providers}
        alertRoutes={routeIds}
      />

      <p className="flex items-start gap-2 text-[11px] leading-5 text-[color:var(--color-komu-muted)]">
        <Radio className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-300" />
        Live checks are independent per account. If one provider is unreachable,
        the others still report their status. A provider error is never shown as
        offline.
      </p>
    </div>
  );
}

function ChannelsSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-hidden>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <div
            key={index}
            className="h-32 animate-pulse rounded-2xl border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)]"
          />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((index) => (
          <div
            key={index}
            className="h-72 animate-pulse rounded-2xl border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)]"
          />
        ))}
      </div>
    </div>
  );
}

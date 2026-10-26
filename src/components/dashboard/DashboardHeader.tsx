import Link from "next/link";
import { Server } from "lucide-react";

import { DashboardUserMenu } from "@/components/dashboard/DashboardUserMenu";
import { StatusDot } from "@/components/dashboard/ui";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db";

/**
 * The dashboard's top command bar.
 *
 * The guild name and member count come from the same database row the rest of
 * the dashboard uses. Nothing external is called here, so the header stays
 * cheap on every navigation.
 */
export async function DashboardHeader() {
  const user = await requireCurrentUser();

  const guild = await prisma.guild.findFirst({
    orderBy: { createdAt: "asc" },
    select: {
      name: true,
      _count: { select: { members: true } },
    },
  });

  return (
    <div className="flex min-w-0 flex-1 items-center justify-between gap-4">
      <Link
        href="/dashboard"
        className="group flex min-w-0 items-center gap-2.5 rounded-lg px-2 py-1.5 transition hover:bg-white/[0.03]"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[color:var(--color-komu-border-muted)] bg-[color:var(--color-komu-surface-raised)] text-[color:var(--color-komu-muted)]">
          <Server className="h-4 w-4" strokeWidth={1.8} />
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-display text-[13px] font-semibold text-[color:var(--color-komu-text)]">
            {guild?.name ?? "No server connected"}
          </span>
          <span className="flex items-center gap-1.5 text-[10px] text-[color:var(--color-komu-dim)]">
            <StatusDot tone={guild ? "success" : "neutral"} pulse={Boolean(guild)} />
            {guild
              ? `${guild._count.members.toLocaleString()} members · control room`
              : "connect Discord to begin"}
          </span>
        </span>
      </Link>

      <DashboardUserMenu username={user.username} avatarUrl={user.avatarUrl} />
    </div>
  );
}

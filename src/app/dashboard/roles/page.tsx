import { Suspense } from "react";

import { requireCurrentUser } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db";
import { listGuildRoles } from "@/lib/discord/rest";
import { SUPPORTED_METRICS, UNAVAILABLE_METRICS } from "@/lib/roles/evaluate-rules";
import { RoleRuleManager } from "./RoleRuleManager";

export const metadata = { title: "Roles" };

/**
 * Role rule configuration.
 *
 * Roles come from Discord so the creator picks from real options. Only
 * metrics with a working data source are offered: the plan says to add a
 * watch-time rule only when the required data exists, and V1 does not
 * collect it.
 */
export default function RolesPage() {
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Roles</h1>
        <p className="text-sm text-[color:var(--color-komu-muted)]">
          Automatically give members a Discord role when they reach a
          milestone.
        </p>
      </header>

      <Suspense fallback={<PanelSkeleton />}>
        <RoleRulesPanel />
      </Suspense>
    </div>
  );
}

async function RoleRulesPanel() {
  await requireCurrentUser("/dashboard/roles");

  const guild = await prisma.guild.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, discordId: true },
  });

  if (!guild) {
    return (
      <p className="rounded-lg border border-[color:var(--color-komu-border)] p-4 text-sm text-[color:var(--color-komu-muted)]">
        Connect a Discord server first.
      </p>
    );
  }

  const [rules, allRoles] = await Promise.all([
    prisma.roleRule.findMany({
      where: { guildId: guild.id },
      select: {
        id: true,
        name: true,
        metric: true,
        threshold: true,
        roleName: true,
        enabled: true,
      },
      orderBy: { createdAt: "asc" },
    }),
    listGuildRoles(guild.discordId),
  ]);

  // @everyone is the server itself and cannot be assigned.
  const roles = allRoles
    .filter((role) => role.id !== guild.discordId)
    .map((role) => ({
      id: role.id,
      label: `@${role.name}`,
      position: role.position,
    }))
    .sort((a, b) => b.position - a.position);

  const unavailable = Object.entries(UNAVAILABLE_METRICS);

  return (
    <div className="flex flex-col gap-6">
      {roles.length === 0 ? (
        <p className="rounded-lg border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] p-4 text-sm text-[color:var(--color-komu-muted)]">
          Komu could not read this server&apos;s roles. Check that the bot is
          in the server and can see them, then reload.
        </p>
      ) : (
        <RoleRuleManager
          roles={roles}
          rules={rules.map((rule) => ({
            id: rule.id,
            name: rule.name,
            metric: rule.metric,
            threshold: rule.threshold,
            roleName: rule.roleName,
            enabled: rule.enabled,
          }))}
          availableMetrics={SUPPORTED_METRICS}
        />
      )}

      {unavailable.length > 0 ? (
        <section className="rounded-lg border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] p-4">
          <h2 className="text-sm font-semibold">Not available yet</h2>
          <ul className="mt-2 flex list-inside list-disc flex-col gap-1 text-sm text-[color:var(--color-komu-muted)]">
            {unavailable.map(([metric, reason]) => (
              <li key={metric}>{reason}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="text-xs text-[color:var(--color-komu-muted)]">
        Rules are checked whenever a member sends a message and when they
        join. A role above the bot&apos;s highest role cannot be assigned;
        check the bot logs if a rule never fires.
      </p>
    </div>
  );
}

function PanelSkeleton() {
  return (
    <div
      className="h-64 animate-pulse rounded-lg border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)]"
      aria-hidden
    />
  );
}
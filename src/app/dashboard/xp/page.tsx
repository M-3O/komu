import { Suspense } from "react";

import { requireCurrentUser } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db";
import { xpForLevel } from "@/lib/levels/calculate-level";
import { XpSettingsForm } from "./XpSettingsForm";

export const metadata = { title: "XP & Levels" };

/** The levels worth showing in the curve preview. */
const CURVE_PREVIEW_LEVELS = [2, 5, 10, 25, 50, 100];

/**
 * XP settings and the level curve (PRD section 7.5).
 *
 * The curve is shown because the XP settings only make sense next to it: a
 * creator choosing 15 XP per message needs to know that is level 5 in about
 * two hours of chatting, not level 50.
 */
export default function XpPage() {
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">XP &amp; Levels</h1>
        <p className="text-sm text-[color:var(--color-komu-muted)]">
          How much members earn for taking part, and how the anti-abuse rules
          apply.
        </p>
      </header>

      <Suspense fallback={<PanelSkeleton />}>
        <XpPanel />
      </Suspense>
    </div>
  );
}

async function XpPanel() {
  await requireCurrentUser("/dashboard/xp");

  const guild = await prisma.guild.findFirstOrThrow({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      xpEnabled: true,
      xpMessageAmount: true,
      xpMessageMinLength: true,
      xpMessageCooldownSecs: true,
      xpDailyCap: true,
      _count: { select: { members: true } },
    },
  });

  return (
    <div className="flex flex-col gap-8">
      <section className="rounded-lg border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] p-6">
        <XpSettingsForm
          settings={{
            xpEnabled: guild.xpEnabled,
            xpMessageAmount: guild.xpMessageAmount,
            xpMessageMinLength: guild.xpMessageMinLength,
            xpMessageCooldownSecs: guild.xpMessageCooldownSecs,
            xpDailyCap: guild.xpDailyCap,
          }}
        />
      </section>

      <section className="rounded-lg border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] p-6">
        <h2 className="font-semibold">The level curve</h2>
        <p className="mt-1 text-sm text-[color:var(--color-komu-muted)]">
          Total XP needed to reach each level. The curve is the same for every
          server and cannot be configured.
        </p>

        <table className="mt-4 text-sm">
          <thead>
            <tr className="text-left text-xs tracking-wider text-[color:var(--color-komu-muted)] uppercase">
              <th className="py-1 pr-6 font-medium">Level</th>
              <th className="py-1 pr-6 font-medium">Total XP</th>
              <th className="py-1 font-medium">Messages</th>
            </tr>
          </thead>
          <tbody>
            {CURVE_PREVIEW_LEVELS.map((level) => (
              <tr key={level} className="border-t border-[color:var(--color-komu-border)]">
                <td className="py-1.5 pr-6">{level}</td>
                <td className="py-1.5 pr-6">{xpForLevel(level).toLocaleString()}</td>
                <td className="py-1.5 text-[color:var(--color-komu-muted)]">
                  {guild.xpMessageAmount > 0
                    ? Math.ceil(xpForLevel(level) / guild.xpMessageAmount).toLocaleString()
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className="mt-4 text-xs text-[color:var(--color-komu-muted)]">
          The message column is how many messages that is worth at your current{" "}
          {guild.xpMessageAmount} XP per message, ignoring cooldowns and the
          daily cap.
        </p>
      </section>

      <section className="rounded-lg border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] p-6">
        <h2 className="font-semibold">Abuse prevention</h2>
        <ul className="mt-2 flex list-inside list-disc flex-col gap-1.5 text-sm text-[color:var(--color-komu-muted)]">
          <li>
            Messages shorter than {guild.xpMessageMinLength} characters earn
            nothing.
          </li>
          <li>
            A member waits{" "}
            {guild.xpMessageCooldownSecs > 0
              ? `${Math.round(guild.xpMessageCooldownSecs / 60)} minute${guild.xpMessageCooldownSecs >= 120 ? "s" : ""}`
              : "no time"}
            {" "}between messages that earn XP.
          </li>
          <li>
            Repeating the same message more than twice in a row stops earning
            XP, so copy-paste spam does not count.
          </li>
          <li>
            {guild.xpDailyCap > 0
              ? `A member can earn ${guild.xpDailyCap.toLocaleString()} XP per day from messages.`
              : "There is no daily cap on message XP."}{" "}
            Rewards, challenges and achievements are not affected by it.
          </li>
        </ul>

        {guild.xpEnabled ? null : (
          <p className="mt-4 rounded-md border border-[color:var(--color-komu-live)] bg-[color:var(--color-komu-live)]/10 p-3 text-sm text-[color:var(--color-komu-live)]">
            XP for messages is switched off. Members do not currently earn XP for
            chatting, but attendance, rewards, challenges and achievements still
            pay out.
          </p>
        )}
      </section>

      <p className="text-xs text-[color:var(--color-komu-muted)]">
        {guild._count.members.toLocaleString()} member
        {guild._count.members === 1 ? "" : "s"} tracked. Switching XP off stops
        new awards but keeps existing XP and levels, so nobody loses progress.
      </p>
    </div>
  );
}

function PanelSkeleton() {
  return (
    <div
      className="h-96 animate-pulse rounded-lg border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)]"
      aria-hidden
    />
  );
}
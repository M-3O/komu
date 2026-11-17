import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarDays, Crown, Repeat2, Target, Users } from "lucide-react";
import { Badge, EmptyState, MetricCard, PageHeader, Panel } from "@/components/dashboard/ui";
import { requireGuild } from "@/lib/dashboard/require-guild";
import { prisma } from "@/lib/db";
import { listGuildRoles } from "@/lib/discord/rest";
import { checkInDeadline, LATE, seasonsEnabled } from "@/lib/seasons/lifecycle";
import { seasonLocalDate } from "@/lib/seasons/schedule";
import { SeasonForm } from "./SeasonForm";
import { manageSeason, manageSeasonGrants, manageSeasonSlot, recoverSeasonPost, saveSeasonDraft, saveSeasonSlot } from "./actions";

export const metadata = { title: "Seasons" };

type Choice = { id: string; label: string };
const difficulties: Record<string, string> = {
  ROLE_DELETED: "The reward role was deleted.",
  ROLE_PERMISSIONS: "Give Komu Manage Roles and move its role above the reward role.",
  MEMBER_LEFT: "The member must rejoin the Discord server before you retry.",
  GUILD_UNAVAILABLE: "Komu cannot reach this Discord server.",
  TEMPORARY_FAILURE: "Discord could not confirm delivery. Retry when it is available.",
};
const PAGE_SIZE = 25;

export default function SeasonsPage({ searchParams }: PageProps<"/dashboard/seasons">) {
  if (!seasonsEnabled()) notFound();
  return (
    <div className="grid gap-6">
      <PageHeader title="Seasons" description="Give members a reason to come back. Schedule streams, set a check-in goal, and reward the regulars." />
      <Suspense fallback={<p className="text-sm text-slate-400">Loading seasons…</p>}>
        <SeasonWorkspace searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

function labelTime(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en", { timeZone, dateStyle: "medium", timeStyle: "short" }).format(date);
}

function ChoiceField({ name, label, choices, selected, required = true }: {
  name: string; label: string; choices: Choice[]; selected?: string; required?: boolean;
}) {
  return (
    <label className="grid gap-1.5 text-sm text-slate-300">
      {label}
      <select className="komu-input w-full" name={name} defaultValue={selected ?? ""} required={required}>
        <option value="">Select {label.toLowerCase()}</option>
        {selected && !choices.some((choice) => choice.id === selected) &&
          <option value={selected}>Previously selected (unavailable)</option>}
        {choices.map((choice) => <option key={choice.id} value={choice.id}>{choice.label}</option>)}
      </select>
    </label>
  );
}

function Input({ label, name, type = "text", value, placeholder, maxLength, required = true }: {
  label: string; name: string; type?: string; value?: string | number; placeholder?: string; maxLength?: number; required?: boolean;
}) {
  return (
    <label className="grid gap-1.5 text-sm text-slate-300">
      {label}
      <input className="komu-input w-full" name={name} type={type} defaultValue={value} placeholder={placeholder}
        required={required} maxLength={maxLength} min={type === "number" ? 1 : undefined} max={type === "number" ? 24 : undefined} />
    </label>
  );
}

function Submit({ children, intent, primary = false }: { children: string; intent?: string; primary?: boolean }) {
  return <button type="submit" name={intent ? "intent" : undefined} value={intent}
    className={`komu-btn w-fit ${primary ? "komu-btn-primary" : "komu-btn-secondary"}`}>{children}</button>;
}

function DraftForm({ roles, season }: {
  roles: Choice[]; season?: { id: string; name: string; goal: number; roleId: string; timeZone: string; endsAt: Date };
}) {
  return (
    <SeasonForm action={saveSeasonDraft}>
      {season && <input type="hidden" name="seasonId" value={season.id} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Season name" name="name" value={season?.name} placeholder="Friday Crew" maxLength={80} />
        <ChoiceField name="roleId" label="Reward role" choices={roles} selected={season?.roleId} />
        <Input label="Check-ins required" name="goal" type="number" value={season?.goal ?? 3} />
        <Input label="Schedule time zone" name="timeZone" value={season?.timeZone ?? "UTC"} placeholder="Asia/Riyadh" maxLength={64} />
        <Input label="Season ends" name="endsAt" type="datetime-local"
          value={season ? seasonLocalDate(season.endsAt, season.timeZone) : undefined} />
      </div>
      <p className="text-xs text-slate-400">Use an IANA time zone such as Asia/Riyadh or America/New_York.</p>
      <Submit primary>{season ? "Save draft" : "Create draft"}</Submit>
    </SeasonForm>
  );
}

function SlotForm({ seasonId, accounts, timeZone, slot }: {
  seasonId: string; accounts: Choice[]; timeZone: string;
  slot?: { id: string; accountId: string; scheduledAt: Date; videoId: string | null };
}) {
  return (
    <SeasonForm action={saveSeasonSlot}>
      <input type="hidden" name="seasonId" value={seasonId} />
      {slot && <input type="hidden" name="slotId" value={slot.id} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <ChoiceField label="Streaming account" name="accountId" choices={accounts} selected={slot?.accountId} />
        <Input label={`Starts in ${timeZone}`} name="scheduledAt" type="datetime-local"
          value={slot ? seasonLocalDate(slot.scheduledAt, timeZone) : undefined} />
        <Input label="Scheduled YouTube link (optional)" name="videoLink" type="url" required={false} maxLength={2048}
          value={slot?.videoId ? `https://www.youtube.com/watch?v=${slot.videoId}` : undefined} />
      </div>
      <Submit>{slot ? "Save new date" : "Add stream slot"}</Submit>
    </SeasonForm>
  );
}

async function SeasonWorkspace({ searchParams }: { searchParams: PageProps<"/dashboard/seasons">["searchParams"] }) {
  const guild = await requireGuild("/dashboard/seasons");
  const params = await searchParams;
  const id = typeof params.season === "string" && /^[a-z0-9]{15,40}$/.test(params.season) ? params.season : undefined;
  const pageParam = typeof params.page === "string" ? Number(params.page) : 1;
  const now = new Date();
  const [choices, accounts, roles] = await Promise.all([
    prisma.season.findMany({ where: { guildId: guild.id }, orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 30, select: { id: true, status: true, name: true, endsAt: true } }),
    prisma.streamingAccount.findMany({ where: { guildId: guild.id, disconnectedAt: null },
      select: { id: true, username: true, provider: true }, orderBy: { username: "asc" } }),
    listGuildRoles(guild.discordId).catch(() => []),
  ]);
  const currentId = id ?? choices.find((item) => item.status === "ACTIVE" && +item.endsAt > +now)?.id ?? choices[0]?.id;
  const season = currentId ? await prisma.season.findFirst({
    where: { id: currentId, guildId: guild.id },
    include: { slots: { orderBy: { scheduledAt: "asc" }, include: {
      account: { select: { provider: true, username: true } },
      _count: { select: { checkIns: true, broadcasts: true } },
      broadcasts: { where: { supersededAt: null }, include: { stream: { include: {
        delivery: { select: { status: true } },
        streamingAccount: { select: { provider: true, username: true } },
      } } } },
    } } },
  }) : null;
  if (id && !season) notFound();
  const accountChoices = accounts.map((a) => ({ id: a.id, label: `${a.username} · ${a.provider}` }));
  const roleChoices = roles.filter((role) => guild.discordId !== role.id).map((r) => ({ id: r.id, label: r.name }));

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[18rem_minmax(0,1fr)]">
      <aside className="grid gap-4">
        {choices.length > 0 && <Panel title="Your seasons" icon={CalendarDays}>
          <nav aria-label="Seasons" className="grid gap-2">
            {choices.map((option) => (
              <Link className="komu-btn komu-btn-secondary justify-between gap-3 text-left"
                aria-current={option.id === currentId ? "page" : undefined}
                href={`/dashboard/seasons?season=${option.id}`} key={option.id}>
                <span className="min-w-0 whitespace-normal break-words">{option.name}</span>
                <span className="text-xs text-slate-400">{option.status === "ACTIVE" && +option.endsAt <= +now
                  ? "Ended" : option.status === "DRAFT" ? "Draft" : option.status === "ACTIVE" ? "Active" : "Closed"}</span>
              </Link>
            ))}
          </nav>
        </Panel>}
        <Panel title="New season" icon={Target}>
          <DraftForm roles={roleChoices} />
        </Panel>
      </aside>
      {!season ? (
        <EmptyState icon={CalendarDays} title="Plan your first season"
          description="Create a draft, add the streams you want to count, and choose a role for members who reach the goal." />
      ) : (
        <div className="grid min-w-0 gap-6">
          <Panel title={season.name} icon={Crown}>
            <div className="grid gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={season.status === "ACTIVE" && +season.endsAt > +now ? "success" : "neutral"}>
                  {season.status === "ACTIVE" && +season.endsAt <= +now ? "Ended" : season.status.toLowerCase()}
                </Badge>
                <span className="text-sm text-slate-300">{season.goal} check-ins · {roleChoices.find((role) => role.id === season.roleId)?.label ?? "Reward role unavailable"}</span>
              </div>
              <p className="text-sm text-slate-300">Ends {labelTime(season.endsAt, season.timeZone)} · {season.timeZone}</p>
              {season.status === "DRAFT" && <>
                <details className="rounded-lg border border-slate-800 p-3">
                  <summary className="cursor-pointer font-medium">Edit settings</summary>
                  <div className="pt-3"><DraftForm roles={roleChoices} season={season} /></div>
                </details>
                <SeasonForm action={manageSeason}>
                  <input type="hidden" name="seasonId" value={season.id} />
                  <Submit intent="activate" primary>Activate season</Submit>
                </SeasonForm>
              </>}
              {season.status === "ACTIVE" && +season.endsAt > +now && <SeasonForm action={manageSeason}
                confirm="Close this season? Members will no longer be able to check in.">
                <input type="hidden" name="seasonId" value={season.id} />
                <Submit intent="close">Close season</Submit>
              </SeasonForm>}
              <details className="rounded-lg border border-slate-800 p-3">
                <summary className="cursor-pointer font-medium">Preview member progress</summary>
                <div className="mt-3 rounded-lg border-l-4 border-indigo-500 bg-slate-900 p-4">
                  <p className="font-semibold">{season.name}</p>
                  <p className="mt-1 text-sm text-slate-300">0 of {season.goal} stream check-ins</p>
                </div>
              </details>
            </div>
          </Panel>

          <Panel title="Scheduled streams" icon={CalendarDays}>
            <div className="grid gap-4">
              {!season.slots.length && <p className="text-sm text-slate-400">Add the broadcasts that should count toward this season.</p>}
              {season.slots.map((slot) => {
                const binding = slot.broadcasts[0];
                const stream = binding?.stream;
                const open = season.status === "ACTIVE" && +season.endsAt > +now;
                const windowOpen = open && binding?.openedAt &&
                  +now < checkInDeadline(binding.openedAt, binding.stream.endedAt, season.endsAt);
                const status = slot.cancelledAt ? "Cancelled" : binding ? windowOpen ? "Check-in open" :
                  binding.openedAt || stream?.endedAt ? "Check-in closed" : "Awaiting check-in post" :
                  +now > +slot.scheduledAt + LATE ? "Missed" : "Scheduled";
                return (
                  <section key={slot.id} className="grid gap-3 rounded-xl border border-slate-800 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="font-semibold">{labelTime(slot.scheduledAt, season.timeZone)}</h3>
                        <p className="text-sm text-slate-300">
                          {stream?.streamingAccount.username ?? slot.account.username} · {stream?.streamingAccount.provider ?? slot.account.provider}
                        </p>
                      </div>
                      <Badge tone={windowOpen ? "success" : "neutral"}>{status}</Badge>
                    </div>
                    <p className="text-sm text-slate-300">
                      {slot._count.checkIns} check-ins{slot.videoId ? " · YouTube link verified" : ""}
                      {binding && " · " + (binding.postMessageId ? "Post linked" : binding.fallbackStatus === "UNCERTAIN"
                        ? "Post delivery uncertain" : binding.fallbackStatus === "BLOCKED" ? "Post blocked" : "Post unlinked")}
                    </p>
                    {binding?.postChannelId && binding.postMessageId && (
                      <a className="w-fit text-sm text-indigo-300 underline"
                        href={`https://discord.com/channels/${guild.discordId}/${binding.postChannelId}/${binding.postMessageId}`}>
                        Open Discord post
                      </a>
                    )}
                    {(open || season.status === "DRAFT") && !slot._count.broadcasts && <>
                      <details>
                        <summary className="w-fit cursor-pointer text-sm text-indigo-300">{slot.cancelledAt ? "Reschedule slot" : "Change schedule"}</summary>
                        <div className="pt-3"><SlotForm seasonId={season.id} accounts={accountChoices} timeZone={season.timeZone} slot={slot} /></div>
                      </details>
                      {!slot.cancelledAt && <SeasonForm action={manageSeasonSlot} confirm="Cancel this unused slot? You can reschedule it later.">
                        <input type="hidden" name="slotId" value={slot.id} />
                        <Submit intent="cancel">Cancel slot</Submit>
                      </SeasonForm>}
                    </>}
                    {open && (
                      <details>
                        <summary className="w-fit cursor-pointer text-sm text-indigo-300">{binding ? "Replace broadcast" : "Attach live broadcast"}</summary>
                        <SeasonForm action={manageSeasonSlot} className="pt-3"
                          confirm={binding ? "Replace this broadcast? Existing check-ins will still count for this slot." : undefined}>
                          <input type="hidden" name="slotId" value={slot.id} />
                          <ChoiceField name="accountId" label="Streaming account" choices={accountChoices} selected={slot.accountId} />
                          <Input name="videoLink" label="Live YouTube link (optional)" type="url" maxLength={2048} required={false} />
                          <Submit intent="attach">{binding ? "Confirm replacement" : "Verify and attach"}</Submit>
                        </SeasonForm>
                      </details>
                    )}
                    {open && binding && (!stream?.endedAt || +stream.endedAt + 15 * 60_000 > +now) && (
                      <SeasonForm action={recoverSeasonPost}>
                        <input type="hidden" name="broadcastId" value={binding.id} />
                        <Submit>Recover check-in post</Submit>
                      </SeasonForm>
                    )}
                  </section>
                );
              })}
              {(season.status === "DRAFT" || (season.status === "ACTIVE" && +season.endsAt > +now)) && (
                <details className="rounded-lg border border-slate-800 p-3" open={season.slots.length === 0}>
                  <summary className="cursor-pointer font-medium">Add a stream</summary>
                  <div className="pt-3"><SlotForm seasonId={season.id} accounts={accountChoices} timeZone={season.timeZone} /></div>
                </details>
              )}
            </div>
          </Panel>

          {season.status !== "DRAFT" && <SeasonRecap seasonId={season.id} page={pageParam} slots={season.slots} />}
          {season.slots.length > 0 && (
            <Panel title="Run it again" icon={Repeat2}>
              <SeasonForm action={manageSeason}>
                <input type="hidden" name="seasonId" value={season.id} />
                <Input label={`First new stream in ${season.timeZone}`} name="firstSlot" type="datetime-local" />
                <Submit intent="duplicate">Duplicate season</Submit>
              </SeasonForm>
            </Panel>
          )}
          {season.status !== "DRAFT" && !roleChoices.some((role) => role.id === season.roleId) && (
            <Panel title="Replace deleted reward role" icon={Crown}>
              <SeasonForm action={manageSeasonGrants}>
                <input type="hidden" name="seasonId" value={season.id} />
                <ChoiceField label="Replacement role" name="roleId" choices={roleChoices} />
                <Submit intent="replace">Verify and replace role</Submit>
              </SeasonForm>
            </Panel>
          )}
        </div>
      )}
    </div>
  );
}

async function SeasonRecap({ seasonId, page, slots }: { seasonId: string; page: number;
  slots: Array<{ _count: { checkIns: number; broadcasts: number } }> }) {
  const [totals] = await prisma.$queryRaw<Array<{ participants: number; returning: number }>>`
    SELECT count(*)::int AS participants, count(*) FILTER (WHERE times >= 2)::int AS returning
    FROM (
      SELECT count(*) AS times
      FROM season_check_ins AS c JOIN season_slots AS s ON s.id = c."slotId"
      WHERE s."seasonId" = ${seasonId}
      GROUP BY c."memberId"
    ) AS member_counts
  `;
  const pages = Math.max(1, Math.ceil(totals.participants / PAGE_SIZE));
  const current = Number.isSafeInteger(page) ? Math.min(pages, Math.max(1, page)) : 1;
  const [grants, members] = await Promise.all([
    prisma.seasonRoleGrant.groupBy({ by: ["status"], where: { seasonId }, _count: { _all: true } }),
    prisma.$queryRaw<Array<{ id: string; username: string; checkIns: number; grantId: string | null;
      status: string | null; reason: string | null }>>`
      SELECT m.id, m.username, count(c."slotId")::int AS "checkIns",
        g.id AS "grantId", g.status::text AS status, g.reason
      FROM season_check_ins AS c
      JOIN season_slots AS s ON s.id = c."slotId"
      JOIN guild_members AS m ON m.id = c."memberId"
      LEFT JOIN season_role_grants AS g ON g."memberId" = m.id AND g."seasonId" = s."seasonId"
      WHERE s."seasonId" = ${seasonId}
      GROUP BY m.id, m.username, g.id, g.status, g.reason
      ORDER BY "checkIns" DESC, m.id
      LIMIT ${PAGE_SIZE} OFFSET ${(current - 1) * PAGE_SIZE}
    `,
  ]);
  const grantCount = (status: "PENDING" | "BLOCKED" | "GRANTED") => grants.find((row) => row.status === status)?._count._all ?? 0;
  const completed = grants.reduce((count, row) => count + row._count._all, 0);
  const held = slots.filter((slot) => slot._count.broadcasts > 0);
  return (
    <Panel title="Season recap" icon={Users}>
      <div className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <MetricCard label="Participants" value={totals.participants} icon={Users} />
          <MetricCard label="Returning participants" value={totals.returning} icon={Repeat2} />
          <MetricCard label="Completions" value={completed} icon={Target} />
          <MetricCard label="Roles delivered" value={grantCount("GRANTED")} icon={Crown} />
        </div>
        <p className="text-sm text-slate-300">{grantCount("PENDING")} roles pending · {grantCount("BLOCKED")} blocked</p>
        {held.length > 1 && <p className="text-sm text-slate-300">
          First held stream: {held[0]._count.checkIns} check-ins · Latest held stream: {held.at(-1)?._count.checkIns} check-ins
        </p>}
        {members.length > 0 && (
          <ul className="divide-y divide-slate-800">
            {members.map((member) => (
              <li key={member.id} className="grid gap-2 py-3">
                <p className="break-words text-sm font-medium">{member.username} · {member.checkIns} check-ins
                  {member.status && " · Role " + member.status.toLowerCase()}</p>
                {member.reason && <p className="text-sm text-slate-400">{difficulties[member.reason] ?? "Delivery is pending."}</p>}
                {member.status === "BLOCKED" && <SeasonForm action={manageSeasonGrants}>
                  <input type="hidden" name="seasonId" value={seasonId} />
                  <input type="hidden" name="grantId" value={member.grantId ?? ""} />
                  <Submit intent="retry">Retry role</Submit>
                </SeasonForm>}
              </li>
            ))}
          </ul>
        )}
        {pages > 1 && (
          <nav className="flex flex-wrap items-center gap-3 text-sm" aria-label="Season participants">
            {current > 1 && <Link className="text-indigo-300 underline" href={`?season=${seasonId}&page=${current - 1}`}>Previous</Link>}
            <span>Page {current} of {pages}</span>
            {current < pages && <Link className="text-indigo-300 underline" href={`?season=${seasonId}&page=${current + 1}`}>Next</Link>}
          </nav>
        )}
      </div>
    </Panel>
  );
}

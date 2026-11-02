"use client";

import {
  CalendarClock,
  CheckCircle2,
  Megaphone,
  Plus,
  Swords,
  Target,
  Trash2,
  Trophy,
  Users,
  Zap,
} from "lucide-react";
import { useActionState, useState } from "react";

import { ConfirmButton } from "@/components/dashboard/ConfirmButton";
import {
  Badge,
  EmptyState,
  FormField,
  Panel,
  ProgressBar,
  StatusMessage,
  cn,
  formatDate,
  initials,
} from "@/components/dashboard/ui";
import {
  createChallengeAction,
  deleteChallengeAction,
  toggleChallengeAction,
  updateChallengeAnnouncementAction,
  type ChallengeFormState,
} from "./actions";

/**
 * Declared here rather than in actions.ts because a "use server" file may only
 * export async functions, and the Client Component imports this value at
 * runtime.
 */
const INITIAL_CHALLENGE_STATE: ChallengeFormState = {};

interface RoleOption {
  id: string;
  label: string;
}

interface ChannelOption {
  id: string;
  label: string;
}

interface RequirementOption {
  value: string;
  label: string;
}

interface RequirementRow {
  label: string;
}

interface ChallengeRow {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  endsAt: string | null;
  xpReward: number;
  rewardRoleName: string | null;
  announcementChannelId: string | null;
  announcementChannelName: string | null;
  requirements: RequirementRow[];
  enrolled: number;
  completed: number;
}

interface ProgressRow {
  /** Unique per progress row, used as the React key. */
  key: string;
  username: string;
  nickname: string | null;
  /** Per-requirement progress, already worded for display. */
  lines: string[];
  completed: boolean;
  completedAt: string | null;
  challengeName: string;
}

/**
 * Create and manage challenges, and see who has finished them.
 *
 * The requirement rows are client state so a creator can add and remove them
 * before submitting. FormData preserves the order of same-named fields, which
 * is what keeps each threshold paired with its type.
 */
export function ChallengeManager({
  challenges,
  roles,
  channels,
  requirementTypes,
  progress,
}: {
  challenges: ChallengeRow[];
  roles: RoleOption[];
  channels: ChannelOption[];
  requirementTypes: RequirementOption[];
  progress: ProgressRow[];
}) {
  const [state, formAction, pending] = useActionState<ChallengeFormState, FormData>(
    createChallengeAction,
    INITIAL_CHALLENGE_STATE,
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_440px]">
        <Panel
          title="Active quests"
          description="Shared goals that move the whole community forward."
          icon={Swords}
          action={<Badge tone="accent">{challenges.length} total</Badge>}
        >
          <ChallengeList challenges={challenges} channels={channels} />
        </Panel>

        <div className="xl:sticky xl:top-24">
          <Panel
            title="Create a challenge"
            description="Set the goal, the window, and the payout."
            icon={Plus}
          >
            <form action={formAction} className="flex flex-col gap-3">
              <FormField label="Name">
                <input
                  name="name"
                  required
                  placeholder="Stream Season"
                  className="komu-input"
                />
              </FormField>

              <FormField label="Description" hint="Optional, shown to members.">
                <input
                  name="description"
                  placeholder="A shared goal for the community"
                  className="komu-input"
                />
              </FormField>

              <div className="grid gap-3 sm:grid-cols-2">
                <FormField label="XP on completion">
                  <input
                    name="xpReward"
                    type="number"
                    min={0}
                    defaultValue={250}
                    className="komu-input"
                  />
                </FormField>

                <FormField label="Ends" hint="Leave empty for no deadline.">
                  <input
                    name="endsAt"
                    type="datetime-local"
                    className="komu-input"
                  />
                </FormField>
              </div>

              <FormField label="Also give role">
                <select name="roleId" defaultValue="" className="komu-input">
                  <option value="">No role</option>
                  {roles.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.label}
                    </option>
                  ))}
                </select>
              </FormField>

              <FormField
                label="Announcement Channel"
                hint="Optional. Komu posts one message here when a member finishes."
              >
                <select
                  name="announcementChannelId"
                  defaultValue=""
                  className="komu-input"
                >
                  <option value="">No announcement</option>
                  {channels.map((channel) => (
                    <option key={channel.id} value={channel.id}>
                      {channel.label}
                    </option>
                  ))}
                </select>
                {channels.length === 0 ? (
                  <span
                    role="alert"
                    className="rounded-lg border border-red-400/25 bg-red-500/[0.07] px-3 py-2.5 text-xs leading-5 text-red-200"
                  >
                    No Discord text channels are available. Check that Komu&apos;s
                    bot can view channels in this server, then refresh. You can
                    leave <strong>No announcement</strong> selected and create
                    the challenge without a destination.
                  </span>
                ) : null}
              </FormField>

              <div className="rounded-xl border border-[color:var(--color-komu-border)] bg-white/[0.015] p-3">
                <RequirementBuilder requirementTypes={requirementTypes} />
              </div>

              <button
                type="submit"
                disabled={pending}
                className="komu-btn komu-btn-primary"
              >
                <Plus className="h-4 w-4" />
                {pending ? "Adding…" : "Add challenge"}
              </button>

              {state?.error ? (
                <StatusMessage tone="error">{state.error}</StatusMessage>
              ) : null}
              {state?.ok ? (
                <StatusMessage tone="success">
                  Challenge added. Progress starts from the next qualifying
                  message, stream attendance or level change. If you chose an
                  announcement channel, Komu will use it when a member finishes.
                </StatusMessage>
              ) : null}
            </form>
          </Panel>
        </div>
      </div>

      <Panel
        title="Member progress"
        description="The latest enrolments and completed conditions."
        icon={Users}
        action={<Badge tone="neutral">{progress.length} recent</Badge>}
        flush
      >
        <ProgressTable progress={progress} />
      </Panel>
    </div>
  );
}

function ChallengeList({
  challenges,
  channels,
}: {
  challenges: ChallengeRow[];
  channels: ChannelOption[];
}) {
  if (challenges.length === 0) {
    return (
      <EmptyState
        icon={Swords}
        title="No challenges yet"
        description="Add one to give the community a shared goal. Existing activity never counts toward a new challenge."
      />
    );
  }

  return (
    <ul className="flex flex-col gap-2.5">
      {challenges.map((challenge) => {
        const percent =
          challenge.enrolled > 0
            ? Math.round((challenge.completed / challenge.enrolled) * 100)
            : 0;

        return (
          <li
            key={challenge.id}
            className={cn(
              "rounded-xl border p-3.5 transition",
              challenge.enabled
                ? "border-[color:var(--color-komu-border)] bg-white/[0.015]"
                : "border-[color:var(--color-komu-border)] bg-white/[0.008] opacity-70",
            )}
          >
            <div className="flex flex-wrap items-start gap-3">
              <span
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border",
                  challenge.enabled
                    ? "border-violet-400/25 bg-violet-500/10 text-violet-300"
                    : "border-[color:var(--color-komu-border-muted)] bg-white/[0.02] text-[color:var(--color-komu-dim)]",
                )}
              >
                <Swords className="h-[18px] w-[18px]" />
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-[color:var(--color-komu-text)]">
                    {challenge.name}
                  </p>
                  <Badge tone={challenge.enabled ? "success" : "neutral"}>
                    {challenge.enabled ? "Active" : "Paused"}
                  </Badge>
                  {challenge.endsAt ? (
                    <Badge tone="warning">
                      <CalendarClock className="h-3 w-3" />
                      Ends {formatDate(challenge.endsAt)}
                    </Badge>
                  ) : (
                    <Badge tone="neutral">No deadline</Badge>
                  )}
                  {challenge.announcementChannelId ? (
                    <Badge tone="accent">
                      <Megaphone className="h-3 w-3" />
                      {challenge.announcementChannelName
                        ? `#${challenge.announcementChannelName}`
                        : "Channel unavailable"}
                    </Badge>
                  ) : null}
                </div>

                {challenge.description ? (
                  <p className="mt-1 text-[11px] leading-5 text-[color:var(--color-komu-muted)]">
                    {challenge.description}
                  </p>
                ) : null}

                <div className="mt-2 flex flex-wrap gap-1.5">
                  {challenge.requirements.map((requirement) => (
                    <span
                      key={requirement.label}
                      className="rounded-md border border-violet-400/20 bg-violet-500/[0.07] px-2 py-1 text-[10px] font-medium text-violet-200"
                    >
                      {requirement.label}
                    </span>
                  ))}
                </div>

                <div className="mt-3">
                  <div className="flex items-center justify-between gap-2 text-[10px]">
                    <span className="text-[color:var(--color-komu-muted)]">
                      {challenge.completed} of {challenge.enrolled} enrolled completed
                    </span>
                    <span className="font-semibold text-[color:var(--color-komu-text)]">
                      {percent}%
                    </span>
                  </div>
                  <ProgressBar value={percent} tone="violet" className="mt-1.5" />
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-[color:var(--color-komu-muted)]">
                  <span className="inline-flex items-center gap-1">
                    <Zap className="h-3 w-3 text-amber-300" />
                    {challenge.xpReward.toLocaleString()} XP
                  </span>
                  {challenge.rewardRoleName ? (
                    <span className="inline-flex items-center gap-1">
                      <Trophy className="h-3 w-3 text-violet-300" />@
                      {challenge.rewardRoleName}
                    </span>
                  ) : null}
                  <span className="inline-flex items-center gap-1">
                    <Users className="h-3 w-3" />
                    {challenge.enrolled.toLocaleString()} enrolled
                  </span>
                </div>

                <AnnouncementChannelForm
                  challengeId={challenge.id}
                  currentChannelId={challenge.announcementChannelId ?? ""}
                  channels={channels}
                />
              </div>

              <div className="flex w-full shrink-0 items-center justify-end gap-2 sm:w-auto">
                <form action={toggleChallengeAction.bind(null, challenge.id)}>
                  <button type="submit" className="komu-btn komu-btn-secondary min-h-8 px-2.5 py-1 text-[11px]">
                    {challenge.enabled ? "Pause" : "Enable"}
                  </button>
                </form>
                <ConfirmButton
                  action={deleteChallengeAction.bind(null, challenge.id)}
                  question="This challenge and all member progress will be removed."
                />
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Point an existing challenge at a completion channel without deleting it.
 *
 * Kept beside the challenge rather than in the create form because an existing
 * challenge's progress must survive changing where its announcements go.
 */
function AnnouncementChannelForm({
  challengeId,
  currentChannelId,
  channels,
}: {
  challengeId: string;
  currentChannelId: string;
  channels: ChannelOption[];
}) {
  const [state, formAction, pending] = useActionState<
    ChallengeFormState,
    FormData
  >(
    updateChallengeAnnouncementAction.bind(null, challengeId),
    INITIAL_CHALLENGE_STATE,
  );

  return (
    <form
      action={formAction}
      className="mt-3 flex flex-wrap items-center gap-2 border-t border-[color:var(--color-komu-border-muted)] pt-2.5"
    >
      <label
        htmlFor={`announcement-channel-${challengeId}`}
        className="inline-flex items-center gap-1 text-[10px] font-medium text-[color:var(--color-komu-muted)]"
      >
        <Megaphone className="h-3 w-3 text-indigo-300" />
        Completion announcement
      </label>
      <select
        id={`announcement-channel-${challengeId}`}
        name="announcementChannelId"
        defaultValue={currentChannelId}
        className="komu-input min-h-8 w-auto max-w-full px-2 py-1 text-[11px]"
      >
        <option value="">No announcement</option>
        {currentChannelId &&
        !channels.some((channel) => channel.id === currentChannelId) ? (
          <option value={currentChannelId}>
            Current channel (unavailable)
          </option>
        ) : null}
        {channels.map((channel) => (
          <option key={channel.id} value={channel.id}>
            {channel.label}
          </option>
        ))}
      </select>
      {currentChannelId &&
      !channels.some((channel) => channel.id === currentChannelId) ? (
        <span className="text-[10px] text-amber-200" role="status">
          The saved channel is unavailable. Choose No announcement or refresh
          after restoring the bot&apos;s access.
        </span>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="komu-btn komu-btn-secondary min-h-8 px-2.5 py-1 text-[11px]"
      >
        {pending ? "Saving…" : "Save"}
      </button>
      {state?.error ? (
        <span role="alert" className="text-[10px] text-red-300">
          {state.error}
        </span>
      ) : null}
      {state?.ok ? (
        <span className="text-[10px] text-emerald-300">
          Announcement setting saved.
        </span>
      ) : null}
    </form>
  );
}

/**
 * Add and remove requirement rows.
 *
 * All three inputs per row share a name, so the submitted order is the same
 * on every one of them and the server can pair each threshold with its type.
 */
function RequirementBuilder({
  requirementTypes,
}: {
  requirementTypes: RequirementOption[];
}) {
  const [rows, setRows] = useState([{ id: 1 }]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="komu-label">Requirements</span>
        <span className="text-[10px] text-[color:var(--color-komu-dim)]">
          All must be met
        </span>
      </div>

      {rows.map((row, index) => (
        <div
          key={row.id}
          className="rounded-lg border border-[color:var(--color-komu-border)] bg-white/[0.02] p-2.5"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-semibold text-[color:var(--color-komu-muted)]">
              Requirement {index + 1}
            </span>
            {rows.length > 1 ? (
              <button
                type="button"
                onClick={() =>
                  setRows((current) =>
                    current.filter((candidate) => candidate.id !== row.id),
                  )
                }
                className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-[10px] text-[color:var(--color-komu-dim)] transition hover:bg-red-500/10 hover:text-red-300"
              >
                <Trash2 className="h-3 w-3" />
                Remove
              </button>
            ) : null}
          </div>

          <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_88px]">
            <select
              name="type"
              defaultValue={requirementTypes[0]?.value}
              className="komu-input"
            >
              {requirementTypes.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
            <input
              name="threshold"
              type="number"
              min={1}
              defaultValue={3}
              required
              aria-label={`Requirement ${index + 1} amount`}
              className="komu-input"
            />
          </div>
          <input
            name="label"
            placeholder="Optional custom wording"
            aria-label={`Requirement ${index + 1} wording`}
            className="komu-input mt-2"
          />
        </div>
      ))}

      <button
        type="button"
        onClick={() =>
          setRows((current) => [
            ...current,
            { id: Math.max(...current.map((r) => r.id)) + 1 },
          ])
        }
        className="komu-btn komu-btn-secondary min-h-8 self-start px-2.5 py-1 text-[11px]"
      >
        <Plus className="h-3.5 w-3.5" />
        Add requirement
      </button>
    </div>
  );
}

/** Who has started a challenge and how far along they are. */
function ProgressTable({ progress }: { progress: ProgressRow[] }) {
  if (progress.length === 0) {
    return (
      <div className="p-5 sm:p-6">
        <EmptyState
          icon={Target}
          title="No member has started a challenge yet"
          description="Progress appears once someone sends a qualifying message or attends a stream."
        />
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="komu-table">
        <thead>
          <tr>
            <th className="pl-5">Member</th>
            <th>Challenge</th>
            <th>Status</th>
            <th className="pr-5">Progress</th>
          </tr>
        </thead>
        <tbody>
          {progress.map((entry) => (
            <tr key={entry.key}>
              <td className="pl-5">
                <div className="flex items-center gap-2">
                  <span className="komu-avatar komu-avatar-sm" aria-hidden>
                    {initials(entry.nickname ?? entry.username)}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-[color:var(--color-komu-text)]">
                      {entry.nickname ?? entry.username}
                    </p>
                    <p className="text-[10px] text-[color:var(--color-komu-dim)]">
                      @{entry.username}
                    </p>
                  </div>
                </div>
              </td>
              <td className="text-xs text-[color:var(--color-komu-muted)]">
                {entry.challengeName}
              </td>
              <td>
                {entry.completed ? (
                  <Badge tone="success">
                    <CheckCircle2 className="h-3 w-3" />
                    Done
                  </Badge>
                ) : (
                  <Badge tone="accent">In progress</Badge>
                )}
                {entry.completedAt ? (
                  <p className="mt-1 text-[10px] text-[color:var(--color-komu-dim)]">
                    {formatDate(entry.completedAt)}
                  </p>
                ) : null}
              </td>
              <td className="pr-5">
                <ul className="flex flex-col gap-0.5 text-[10px] leading-4 text-[color:var(--color-komu-muted)]">
                  {entry.lines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

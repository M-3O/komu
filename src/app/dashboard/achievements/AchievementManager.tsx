"use client";

import {
  Award,
  EyeOff,
  Lock,
  Medal,
  Plus,
  Sparkles,
  Trophy,
} from "lucide-react";
import { useActionState } from "react";

import { ConfirmButton } from "@/components/dashboard/ConfirmButton";
import {
  Badge,
  EmptyState,
  FormField,
  Panel,
  StatusMessage,
  cn,
  formatDate,
  initials,
} from "@/components/dashboard/ui";
import {
  createAchievementAction,
  deleteAchievementAction,
  toggleAchievementAction,
  type AchievementFormState,
} from "./actions";

/**
 * Declared here rather than in actions.ts because a "use server" file may only
 * export async functions, and the Client Component imports this value at
 * runtime.
 */
const INITIAL_ACHIEVEMENT_STATE: AchievementFormState = {};

interface RoleOption {
  id: string;
  label: string;
}

interface TypeOption {
  value: string;
  label: string;
  defaultThreshold: number;
}

interface AchievementRow {
  id: string;
  name: string;
  description: string;
  icon: string;
  type: string;
  threshold: number;
  xpReward: number;
  roleName: string | null;
  enabled: boolean;
  hidden: boolean;
  unlockedBy: number;
}

interface UnlockRow {
  username: string;
  nickname: string | null;
  achievementName: string;
  icon: string;
  unlockedAt: string;
}

/** Create and manage achievements, and see who has unlocked them. */
export function AchievementManager({
  achievements,
  roles,
  types,
  unlocks,
}: {
  achievements: AchievementRow[];
  roles: RoleOption[];
  types: TypeOption[];
  unlocks: UnlockRow[];
}) {
  const [state, formAction, pending] = useActionState<AchievementFormState, FormData>(
    createAchievementAction,
    INITIAL_ACHIEVEMENT_STATE,
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_430px]">
        <Panel
          title="Milestone catalogue"
          description="Permanent milestones. Unlocks are never taken away."
          icon={Medal}
          action={<Badge tone="accent">{achievements.length} total</Badge>}
        >
          <AchievementList achievements={achievements} />
        </Panel>

        <div className="xl:sticky xl:top-24">
          <Panel
            title="Create an achievement"
            description="A permanent milestone with a payout."
            icon={Sparkles}
          >
            <form action={formAction} className="flex flex-col gap-3">
              <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-3">
                <FormField label="Icon" hint="Emoji">
                  <input
                    name="icon"
                    required
                    maxLength={8}
                    placeholder="🏆"
                    className="komu-input px-0 text-center text-lg"
                  />
                </FormField>
                <FormField label="Name">
                  <input
                    name="name"
                    required
                    placeholder="OG Member"
                    className="komu-input"
                  />
                </FormField>
              </div>

              <FormField label="Description">
                <input
                  name="description"
                  required
                  placeholder="Here from the very beginning"
                  className="komu-input"
                />
              </FormField>

              <div className="grid gap-3 sm:grid-cols-2">
                <FormField label="Requirement">
                  <select name="type" className="komu-input">
                    {types.map((type) => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                </FormField>

                <FormField label="Threshold">
                  <input
                    name="threshold"
                    type="number"
                    min={1}
                    defaultValue={types[0]?.defaultThreshold ?? 10}
                    required
                    className="komu-input"
                  />
                </FormField>

                <FormField label="XP on unlock">
                  <input
                    name="xpReward"
                    type="number"
                    min={0}
                    defaultValue={100}
                    className="komu-input"
                  />
                </FormField>

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
              </div>

              <label className="flex items-center justify-between gap-3 rounded-xl border border-[color:var(--color-komu-border)] bg-white/[0.015] px-3 py-2.5">
                <span>
                  <span className="block text-xs font-medium text-[color:var(--color-komu-text)]">
                    Hidden until unlocked
                  </span>
                  <span className="mt-0.5 block text-[10px] leading-4 text-[color:var(--color-komu-dim)]">
                    Keep the milestone secret in member-facing lists.
                  </span>
                </span>
                <input type="checkbox" name="hidden" className="komu-switch" />
              </label>

              <button
                type="submit"
                disabled={pending}
                className="komu-btn komu-btn-primary"
              >
                <Plus className="h-4 w-4" />
                {pending ? "Adding…" : "Add achievement"}
              </button>

              {state?.error ? (
                <StatusMessage tone="error">{state.error}</StatusMessage>
              ) : null}
              {state?.ok ? (
                <StatusMessage tone="success">
                  Achievement added. Anyone already meeting it unlocks it on
                  their next qualifying activity.
                </StatusMessage>
              ) : null}
            </form>
          </Panel>
        </div>
      </div>

      <Panel
        title="Recent unlocks"
        description="The newest milestones earned by members."
        icon={Trophy}
        action={<Badge tone="neutral">{unlocks.length} recent</Badge>}
        flush
      >
        <UnlockList unlocks={unlocks} />
      </Panel>
    </div>
  );
}

function AchievementList({ achievements }: { achievements: AchievementRow[] }) {
  if (achievements.length === 0) {
    return (
      <EmptyState
        icon={Medal}
        title="No achievements yet"
        description="Add a permanent milestone for members to work towards."
      />
    );
  }

  return (
    <div className="grid gap-2.5 sm:grid-cols-2">
      {achievements.map((achievement) => (
        <article
          key={achievement.id}
          className={cn(
            "flex flex-col rounded-xl border p-3.5 transition",
            achievement.enabled
              ? "border-[color:var(--color-komu-border)] bg-white/[0.015]"
              : "border-[color:var(--color-komu-border)] bg-white/[0.008] opacity-70",
          )}
        >
          <div className="flex items-start gap-2.5">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-amber-400/20 bg-amber-500/[0.08] text-xl">
              {achievement.icon}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <p className="truncate text-sm font-semibold text-[color:var(--color-komu-text)]">
                  {achievement.name}
                </p>
                <Badge tone={achievement.enabled ? "success" : "neutral"}>
                  {achievement.enabled ? "Active" : "Paused"}
                </Badge>
              </div>
              <p className="mt-0.5 line-clamp-2 text-[10px] leading-4 text-[color:var(--color-komu-muted)]">
                {achievement.description}
              </p>
            </div>
          </div>

          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {achievement.hidden ? (
              <Badge tone="violet">
                <EyeOff className="h-3 w-3" />
                Hidden
              </Badge>
            ) : null}
            <Badge tone="accent">
              {achievement.threshold.toLocaleString()}{" "}
              {unitForCount(achievement.threshold, achievement.type)}
            </Badge>
            <Badge tone="warning">{achievement.xpReward.toLocaleString()} XP</Badge>
            {achievement.roleName ? <Badge tone="neutral">@{achievement.roleName}</Badge> : null}
          </div>

          <div className="mt-3 flex items-center justify-between gap-2 border-t border-[color:var(--color-komu-border)] pt-2.5">
            <span className="inline-flex items-center gap-1.5 text-[10px] text-[color:var(--color-komu-muted)]">
              {achievement.unlockedBy > 0 ? (
                <Award className="h-3.5 w-3.5 text-amber-300" />
              ) : (
                <Lock className="h-3.5 w-3.5 text-[color:var(--color-komu-dim)]" />
              )}
              {achievement.unlockedBy > 0
                ? `${achievement.unlockedBy.toLocaleString()} unlocked`
                : "Unclaimed"}
            </span>

            <div className="flex items-center gap-1.5">
              <form action={toggleAchievementAction.bind(null, achievement.id)}>
                <button type="submit" className="komu-btn komu-btn-secondary min-h-7 px-2 py-1 text-[10px]">
                  {achievement.enabled ? "Pause" : "Enable"}
                </button>
              </form>
              <ConfirmButton
                action={deleteAchievementAction.bind(null, achievement.id)}
                question="This achievement and every member's unlock will be removed."
                className="komu-btn komu-btn-danger min-h-7 px-2 py-1 text-[10px]"
              />
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

function UnlockList({ unlocks }: { unlocks: UnlockRow[] }) {
  if (unlocks.length === 0) {
    return (
      <div className="p-5 sm:p-6">
        <EmptyState
          icon={Trophy}
          title="Nobody has unlocked an achievement yet"
          description="Unlocks appear here as members reach permanent milestones."
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
            <th>Achievement</th>
            <th className="pr-5 text-right">Unlocked</th>
          </tr>
        </thead>
        <tbody>
          {unlocks.map((unlock) => (
            <tr key={`${unlock.username}-${unlock.achievementName}`}>
              <td className="pl-5">
                <div className="flex items-center gap-2">
                  <span className="komu-avatar komu-avatar-sm" aria-hidden>
                    {initials(unlock.nickname ?? unlock.username)}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-[color:var(--color-komu-text)]">
                      {unlock.nickname ?? unlock.username}
                    </p>
                    <p className="text-[10px] text-[color:var(--color-komu-dim)]">
                      @{unlock.username}
                    </p>
                  </div>
                </div>
              </td>
              <td>
                <span className="inline-flex items-center gap-2 text-xs text-[color:var(--color-komu-text)]">
                  <span className="text-base">{unlock.icon}</span>
                  {unlock.achievementName}
                </span>
              </td>
              <td className="pr-5 text-right text-[10px] text-[color:var(--color-komu-muted)]">
                {formatDate(unlock.unlockedAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** "1 stream", not "1 streams". Units are short labels, not full sentences. */
function unitForCount(count: number, unit: string): string {
  if (count !== 1) return unit;

  return unit
    .replace(/\bmessages\b/g, "message")
    .replace(/\bstreams\b/g, "stream")
    .replace(/\bdays\b/g, "day")
    .replace(/\bhours\b/g, "hour");
}

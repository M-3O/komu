"use client";

import { useActionState } from "react";

  import {
  createAchievementAction,
  deleteAchievementAction,
  INITIAL_ACHIEVEMENT_STATE,
  toggleAchievementAction,
  type AchievementFormState,
} from "./actions";
import { ConfirmButton } from "@/components/dashboard/ConfirmButton";

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
    <div className="flex flex-col gap-8">
      <AchievementList achievements={achievements} />

      <form action={formAction} className="flex flex-col gap-4">
        <h2 className="font-semibold">Add an achievement</h2>

        <div className="flex flex-wrap items-end gap-3">
          <Field label="Icon">
            <input
              name="icon"
              required
              maxLength={8}
              placeholder="🏆"
              className="w-16 rounded-md border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] px-3 py-2 text-center"
            />
          </Field>

          <Field label="Name">
            <input
              name="name"
              required
              placeholder="OG Member"
              className="w-44 rounded-md border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] px-3 py-2"
            />
          </Field>

          <Field label="Description">
            <input
              name="description"
              required
              placeholder="Here for the very beginning"
              className="w-64 rounded-md border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] px-3 py-2"
            />
          </Field>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <Field label="Requirement">
            <select name="type" className="rounded-md border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] px-3 py-2">
              {types.map((type) => (
                <option key={type.value} value={type.value} data-threshold={type.defaultThreshold}>
                  {type.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="How much">
            <input
              name="threshold"
              type="number"
              min={1}
              defaultValue={types[0]?.defaultThreshold ?? 10}
              required
              className="w-24 rounded-md border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] px-3 py-2"
            />
          </Field>

          <Field label="XP on unlock">
            <input
              name="xpReward"
              type="number"
              min={0}
              defaultValue={100}
              className="w-28 rounded-md border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] px-3 py-2"
            />
          </Field>

          <Field label="Also give role">
            <select
              name="roleId"
              defaultValue=""
              className="rounded-md border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] px-3 py-2"
            >
              <option value="">None</option>
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="hidden" />
          Hidden until unlocked
        </label>

        <button
          type="submit"
          disabled={pending}
          className="self-start rounded-lg bg-[color:var(--color-komu-accent)] px-5 py-2 font-medium text-white transition hover:bg-[color:var(--color-komu-accent-hover)] disabled:opacity-60"
        >
          {pending ? "Adding..." : "Add achievement"}
        </button>

        {state?.error ? (
          <p
            role="alert"
            className="rounded-md border border-[color:var(--color-komu-live)] bg-[color:var(--color-komu-live)]/10 p-3 text-sm text-[color:var(--color-komu-live)]"
          >
            {state.error}
          </p>
        ) : null}

        {state?.ok ? (
          <p className="rounded-md border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] p-3 text-sm">
            Achievement added. Anyone who already meets the requirement unlocks
            it the next time they send a qualifying message.
          </p>
        ) : null}
      </form>

      <UnlockList unlocks={unlocks} />
    </div>
  );
}

function AchievementList({ achievements }: { achievements: AchievementRow[] }) {
  if (achievements.length === 0) {
    return (
      <p className="rounded-lg border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] p-4 text-sm text-[color:var(--color-komu-muted)]">
        No achievements yet. Add one below as a permanent milestone members work
        towards.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {achievements.map((achievement) => (
        <li
          key={achievement.id}
          className="flex flex-wrap items-center gap-3 rounded-lg border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] p-4"
        >
          <span className={achievement.enabled ? "" : "opacity-50"}>
            <span className="font-medium">
              {achievement.icon} {achievement.name}
              {achievement.hidden ? (
                <span className="ml-2 rounded-full bg-[color:var(--color-komu-surface-raised)] px-2 py-0.5 text-xs text-[color:var(--color-komu-muted)]">
                  Hidden
                </span>
              ) : null}
            </span>
            <span className="block text-sm text-[color:var(--color-komu-muted)]">
              {achievement.description}
            </span>
            <span className="block text-xs text-[color:var(--color-komu-muted)]">
              {achievement.threshold}+ {achievement.type.toLowerCase().replace(/_/g, " ")}
              {" · "}
              gives {achievement.xpReward} XP
              {achievement.roleName ? ` and @${achievement.roleName}` : ""}
              {" · "}
              {achievement.unlockedBy} unlocked
            </span>
          </span>

          <span className="ml-auto flex gap-2">
            <form action={toggleAchievementAction.bind(null, achievement.id)}>
              <button
                type="submit"
                className="rounded-md border border-[color:var(--color-komu-border)] px-3 py-1.5 text-sm hover:bg-[color:var(--color-komu-surface-raised)]"
              >
                {achievement.enabled ? "Disable" : "Enable"}
              </button>
            </form>

            <ConfirmButton action={deleteAchievementAction.bind(null, achievement.id)} question="This achievement and every member's unlock will be removed." />
          </span>
        </li>
      ))}
    </ul>
  );
}

function UnlockList({ unlocks }: { unlocks: UnlockRow[] }) {
  if (unlocks.length === 0) {
    return (
      <p className="rounded-lg border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] p-4 text-sm text-[color:var(--color-komu-muted)]">
        Nobody has unlocked an achievement yet.
      </p>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-semibold">Recent unlocks</h2>

      <ul className="flex flex-col gap-1">
        {unlocks.map((unlock) => (
          <li
            key={`${unlock.username}-${unlock.achievementName}`}
            className="rounded-md border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] px-4 py-2 text-sm"
          >
            <span className="font-medium">{unlock.nickname ?? unlock.username}</span>
            <span className="text-[color:var(--color-komu-muted)]">
              {" unlocked "}
              {unlock.icon} {unlock.achievementName} ·{" "}
              {new Date(unlock.unlockedAt).toLocaleDateString()}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs tracking-wider text-[color:var(--color-komu-muted)] uppercase">
        {label}
      </span>
      {children}
    </label>
  );
}

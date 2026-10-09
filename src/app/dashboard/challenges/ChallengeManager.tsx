"use client";

import { useActionState, useState } from "react";

  import {
  createChallengeAction,
  deleteChallengeAction,
  INITIAL_CHALLENGE_STATE,
  toggleChallengeAction,
  type ChallengeFormState,
} from "./actions";
import { ConfirmButton } from "@/components/dashboard/ConfirmButton";

interface RoleOption {
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
  requirementTypes,
  progress,
}: {
  challenges: ChallengeRow[];
  roles: RoleOption[];
  requirementTypes: RequirementOption[];
  progress: ProgressRow[];
}) {
  const [state, formAction, pending] = useActionState<ChallengeFormState, FormData>(
    createChallengeAction,
    INITIAL_CHALLENGE_STATE,
  );

  return (
    <div className="flex flex-col gap-8">
      <ChallengeList challenges={challenges} />

      <form action={formAction} className="flex flex-col gap-4">
        <h2 className="font-semibold">Add a challenge</h2>

        <div className="flex flex-wrap items-end gap-3">
          <Field label="Name">
            <input
              name="name"
              required
              placeholder="Stream Season"
              className="w-44 rounded-md border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] px-3 py-2"
            />
          </Field>

          <Field label="Description">
            <input
              name="description"
              placeholder="Optional"
              className="w-52 rounded-md border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] px-3 py-2"
            />
          </Field>

          <Field label="XP on completion">
            <input
              name="xpReward"
              type="number"
              min={0}
              defaultValue={250}
              className="w-28 rounded-md border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] px-3 py-2"
            />
          </Field>

          <Field label="Ends">
            <input
              name="endsAt"
              type="datetime-local"
              className="rounded-md border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] px-3 py-2"
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

        <RequirementBuilder requirementTypes={requirementTypes} />

        <button
          type="submit"
          disabled={pending}
          className="self-start rounded-lg bg-[color:var(--color-komu-accent)] px-5 py-2 font-medium text-white transition hover:bg-[color:var(--color-komu-accent-hover)] disabled:opacity-60"
        >
          {pending ? "Adding..." : "Add challenge"}
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
            Challenge added. Progress starts from the next qualifying message,
            stream attendance or level change, so existing activity does not
            count towards it.
          </p>
        ) : null}
      </form>

      <ProgressTable progress={progress} />
    </div>
  );
}

function ChallengeList({ challenges }: { challenges: ChallengeRow[] }) {
  if (challenges.length === 0) {
    return (
      <p className="rounded-lg border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] p-4 text-sm text-[color:var(--color-komu-muted)]">
        No challenges yet. Add one below to give the community a shared goal.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {challenges.map((challenge) => (
        <li
          key={challenge.id}
          className="flex flex-wrap items-center gap-3 rounded-lg border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] p-4"
        >
          <span className={challenge.enabled ? "" : "opacity-50"}>
            <span className="font-medium">{challenge.name}</span>
            <span className="ml-2 text-sm text-[color:var(--color-komu-muted)]">
              {challenge.requirements.map((requirement) => requirement.label).join(" + ")}
            </span>
            {challenge.description ? (
              <span className="block text-xs text-[color:var(--color-komu-muted)]">
                {challenge.description}
              </span>
            ) : null}
            <span className="block text-xs text-[color:var(--color-komu-muted)]">
              Gives {challenge.xpReward} XP
              {challenge.rewardRoleName ? ` and @${challenge.rewardRoleName}` : ""}
              {challenge.endsAt ? ` · ends ${challenge.endsAt}` : " · no end date"}
              {" · "}
              {challenge.completed} of {challenge.enrolled} enrolled completed
            </span>
          </span>

          <span className="ml-auto flex gap-2">
            <form action={toggleChallengeAction.bind(null, challenge.id)}>
              <button
                type="submit"
                className="rounded-md border border-[color:var(--color-komu-border)] px-3 py-1.5 text-sm hover:bg-[color:var(--color-komu-surface-raised)]"
              >
                {challenge.enabled ? "Disable" : "Enable"}
              </button>
            </form>

            <ConfirmButton action={deleteChallengeAction.bind(null, challenge.id)} question="This challenge and all member progress will be removed." />
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Add and remove requirement rows.
 *
 * All three inputs per row share a name, so the submitted order is the same
 * on every one of them and the server can pair each threshold with its type.
 */
function RequirementBuilder({ requirementTypes }: { requirementTypes: RequirementOption[] }) {
  const [rows, setRows] = useState([{ id: 1 }]);

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs tracking-wider text-[color:var(--color-komu-muted)] uppercase">
        Requirements (all must be met)
      </span>

      {rows.map((row, index) => (
        <div key={row.id} className="flex flex-wrap items-end gap-3">
          <Field label={`Requirement ${index + 1}`}>
            <select
              name="type"
              defaultValue={requirementTypes[0]?.value}
              className="rounded-md border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] px-3 py-2"
            >
              {requirementTypes.map((type) => (
                <option key={type.value} value={type.value}>
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
              defaultValue={3}
              required
              className="w-24 rounded-md border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] px-3 py-2"
            />
          </Field>

          <Field label="Wording (optional)">
            <input
              name="label"
              placeholder={undefined}
              className="w-52 rounded-md border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] px-3 py-2"
            />
          </Field>

          {rows.length > 1 ? (
            <button
              type="button"
              onClick={() =>
                setRows((current) => current.filter((candidate) => candidate.id !== row.id))
              }
              className="rounded-md border border-[color:var(--color-komu-border)] px-3 py-2 text-sm text-[color:var(--color-komu-muted)] hover:text-[color:var(--color-komu-live)]"
            >
              Remove
            </button>
          ) : null}
        </div>
      ))}

      <button
        type="button"
        onClick={() =>
          setRows((current) => [...current, { id: Math.max(...current.map((r) => r.id)) + 1 }])
        }
        className="self-start rounded-md border border-[color:var(--color-komu-border)] px-3 py-1.5 text-sm hover:bg-[color:var(--color-komu-surface-raised)]"
      >
        Add another requirement
      </button>
    </div>
  );
}

/** Who has started a challenge and how far along they are. */
function ProgressTable({ progress }: { progress: ProgressRow[] }) {
  if (progress.length === 0) {
    return (
      <p className="rounded-lg border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] p-4 text-sm text-[color:var(--color-komu-muted)]">
        No member has started a challenge yet. Progress appears once someone
        sends a qualifying message or attends a stream.
      </p>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-semibold">Progress</h2>

      <ul className="flex flex-col gap-2">
        {progress.map((entry) => (
          <li
            key={entry.key}
            className="rounded-lg border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] p-4"
          >
            <div className="flex items-center gap-2">
              <span className="font-medium">{entry.nickname ?? entry.username}</span>
              <span className="text-xs text-[color:var(--color-komu-muted)]">
                {entry.challengeName}
              </span>
              {entry.completed ? (
                <span className="rounded-full bg-[color:var(--color-komu-accent)]/15 px-2 py-0.5 text-xs text-[color:var(--color-komu-accent)]">
                  Completed
                </span>
              ) : null}
            </div>

            <ul className="mt-1 flex list-inside list-disc flex-col gap-0.5 text-sm text-[color:var(--color-komu-muted)]">
              {entry.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
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

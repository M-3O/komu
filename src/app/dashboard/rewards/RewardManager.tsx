"use client";

import { useActionState, useState } from "react";

import {
  createRewardAction,
  deleteRewardAction,
  INITIAL_REWARD_STATE,
  toggleRewardAction,
  type RewardFormState,
} from "./actions";

interface RoleOption {
  id: string;
  label: string;
}

interface AchievementOption {
  id: string;
  name: string;
}

interface MetricOption {
  value: string;
  label: string;
}

interface ActionOption {
  value: string;
  label: string;
}

interface RewardRow {
  id: string;
  name: string;
  description: string | null;
  /** The condition's unit, e.g. "streams". Already worded for display. */
  metricLabel: string;
  threshold: number;
  repeatable: boolean;
  enabled: boolean;
  grantCount: number;
  /** How the reward reads for a member, e.g. "500 XP" or "@VIP". */
  actions: string[];
}

/** Create and manage rewards. */
export function RewardManager({
  rewards,
  roles,
  achievements,
  metrics,
  actionTypes,
}: {
  rewards: RewardRow[];
  roles: RoleOption[];
  achievements: AchievementOption[];
  metrics: MetricOption[];
  actionTypes: ActionOption[];
}) {
  const [state, formAction, pending] = useActionState<RewardFormState, FormData>(
    createRewardAction,
    INITIAL_REWARD_STATE,
  );

  return (
    <div className="flex flex-col gap-8">
      <RewardList rewards={rewards} />

      <form action={formAction} className="flex flex-col gap-3">
        <h2 className="font-semibold">Add a reward</h2>

        <div className="flex flex-wrap items-end gap-3">
          <Field label="Name">
            <input
              name="name"
              required
              placeholder="Stream Regular"
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

          <Field label="When">
            <select
              name="metric"
              defaultValue={metrics[0]?.value}
              className="rounded-md border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] px-3 py-2"
            >
              {metrics.map((metric) => (
                <option key={metric.value} value={metric.value}>
                  {metric.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Threshold">
            <input
              name="threshold"
              type="number"
              min={0}
              defaultValue={5}
              required
              className="w-28 rounded-md border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] px-3 py-2"
            />
          </Field>
        </div>

        <ActionPicker actionTypes={actionTypes} roles={roles} achievements={achievements} />

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="repeatable" />
          Can be granted more than once
        </label>

        <button
          type="submit"
          disabled={pending}
          className="self-start rounded-lg bg-[color:var(--color-komu-accent)] px-5 py-2 font-medium text-white transition hover:bg-[color:var(--color-komu-accent-hover)] disabled:opacity-60"
        >
          {pending ? "Adding..." : "Add reward"}
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
            Reward added. It applies the next time a member qualifies.
          </p>
        ) : null}
      </form>
    </div>
  );
}

/** The list of existing rewards, with enable and delete. */
function RewardList({ rewards }: { rewards: RewardRow[] }) {
  if (rewards.length === 0) {
    return (
      <p className="rounded-lg border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] p-4 text-sm text-[color:var(--color-komu-muted)]">
        No rewards yet. Add one below to give members something for reaching a
        milestone.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {rewards.map((reward) => (
        <li
          key={reward.id}
          className="flex flex-wrap items-center gap-3 rounded-lg border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] p-4"
        >
          <span className={reward.enabled ? "" : "opacity-50"}>
            <span className="font-medium">{reward.name}</span>
            <span className="ml-2 text-sm text-[color:var(--color-komu-muted)]">
              {reward.threshold}+ {reward.metricLabel} -&gt; {reward.actions.join(" + ")}
              {reward.repeatable ? " (repeatable)" : ""}
            </span>
            {reward.description ? (
              <span className="block text-xs text-[color:var(--color-komu-muted)]">
                {reward.description}
              </span>
            ) : null}
            <span className="block text-xs text-[color:var(--color-komu-muted)]">
              Granted to {reward.grantCount}{" "}
              {reward.grantCount === 1 ? "member" : "members"}
            </span>
          </span>

          <span className="ml-auto flex gap-2">
            <form action={toggleRewardAction.bind(null, reward.id)}>
              <button
                type="submit"
                className="rounded-md border border-[color:var(--color-komu-border)] px-3 py-1.5 text-sm hover:bg-[color:var(--color-komu-surface-raised)]"
              >
                {reward.enabled ? "Disable" : "Enable"}
              </button>
            </form>

            <form action={deleteRewardAction.bind(null, reward.id)}>
              <button
                type="submit"
                className="rounded-md border border-[color:var(--color-komu-border)] px-3 py-1.5 text-sm text-[color:var(--color-komu-muted)] transition hover:border-[color:var(--color-komu-live)] hover:text-[color:var(--color-komu-live)]"
              >
                Delete
              </button>
            </form>
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Choose the effect, and only the fields it needs.
 *
 * Showing every field at once would mean the form submits values for actions
 * that were not chosen, and the server would have to guess which ones matter.
 */
function ActionPicker({
  actionTypes,
  roles,
  achievements,
}: {
  actionTypes: ActionOption[];
  roles: RoleOption[];
  achievements: AchievementOption[];
}) {
  const [selected, setSelected] = useState(actionTypes[0]?.value ?? "");

  return (
    <div className="flex flex-wrap items-end gap-3">
      <Field label="Then">
        <select
          name="actionType"
          value={selected}
          onChange={(event) => setSelected(event.target.value)}
          className="rounded-md border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] px-3 py-2"
        >
          {actionTypes.map((action) => (
            <option key={action.value} value={action.value}>
              {action.label}
            </option>
          ))}
        </select>
      </Field>

      {selected === "GIVE_XP" ? (
        <Field label="How much XP">
          <input
            name="xpAmount"
            type="number"
            min={1}
            defaultValue={500}
            required
            className="w-28 rounded-md border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] px-3 py-2"
          />
        </Field>
      ) : null}

      {selected === "ADD_ROLE" || selected === "REMOVE_ROLE" ? (
        <Field label="Role">
          <select
            name="roleId"
            required
            defaultValue=""
            className="rounded-md border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] px-3 py-2"
          >
            <option value="" disabled>
              Choose a role
            </option>
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.label}
              </option>
            ))}
          </select>
        </Field>
      ) : null}

      {selected === "UNLOCK_ACHIEVEMENT" ? (
        <Field label="Achievement">
          <select
            name="achievementId"
            required
            defaultValue=""
            className="rounded-md border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] px-3 py-2"
          >
            <option value="" disabled>
              {achievements.length === 0
                ? "No achievements yet"
                : "Choose an achievement"}
            </option>
            {achievements.map((achievement) => (
              <option key={achievement.id} value={achievement.id}>
                {achievement.name}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
    </div>
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
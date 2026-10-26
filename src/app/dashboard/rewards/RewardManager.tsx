"use client";

import { Gift, Plus, Sparkles, Users } from "lucide-react";
import { useActionState, useState } from "react";

import { ConfirmButton } from "@/components/dashboard/ConfirmButton";
import {
  Badge,
  EmptyState,
  FormField,
  Panel,
  StatusMessage,
  cn,
} from "@/components/dashboard/ui";
import {
  createRewardAction,
  deleteRewardAction,
  toggleRewardAction,
  type RewardFormState,
} from "./actions";

/**
 * Declared here rather than in actions.ts because a "use server" file may only
 * export async functions, and the Client Component imports this value at
 * runtime.
 */
const INITIAL_REWARD_STATE: RewardFormState = {};

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
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
      <Panel
        title="Reward rules"
        description="Conditions that pay out XP, roles, or achievements."
        icon={Gift}
        action={<Badge tone="accent">{rewards.length} total</Badge>}
      >
        <RewardList rewards={rewards} />
      </Panel>

      <div className="xl:sticky xl:top-24">
        <Panel
          title="Create a reward"
          description="One condition, one payout."
          icon={Sparkles}
        >
          <form action={formAction} className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
              <FormField label="Name">
                <input
                  name="name"
                  required
                  placeholder="Stream Regular"
                  className="komu-input"
                />
              </FormField>

              <FormField label="Description" hint="Optional, shown in the dashboard.">
                <input
                  name="description"
                  placeholder="Reward for showing up"
                  className="komu-input"
                />
              </FormField>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="When">
                <select
                  name="metric"
                  defaultValue={metrics[0]?.value}
                  className="komu-input"
                >
                  {metrics.map((metric) => (
                    <option key={metric.value} value={metric.value}>
                      {metric.label}
                    </option>
                  ))}
                </select>
              </FormField>

              <FormField label="Threshold">
                <input
                  name="threshold"
                  type="number"
                  min={0}
                  defaultValue={5}
                  required
                  className="komu-input"
                />
              </FormField>
            </div>

            <div className="rounded-xl border border-[color:var(--color-komu-border)] bg-white/[0.015] p-3">
              <p className="komu-label mb-2">Then pay out</p>
              <ActionPicker
                actionTypes={actionTypes}
                roles={roles}
                achievements={achievements}
              />
            </div>

            <label className="flex items-center justify-between gap-3 rounded-xl border border-[color:var(--color-komu-border)] bg-white/[0.015] px-3 py-2.5">
              <span>
                <span className="block text-xs font-medium text-[color:var(--color-komu-text)]">
                  Repeatable
                </span>
                <span className="mt-0.5 block text-[10px] leading-4 text-[color:var(--color-komu-dim)]">
                  Grant more than once when the condition is met again.
                </span>
              </span>
              <input type="checkbox" name="repeatable" className="komu-switch" />
            </label>

            <button
              type="submit"
              disabled={pending}
              className="komu-btn komu-btn-primary"
            >
              <Plus className="h-4 w-4" />
              {pending ? "Adding…" : "Add reward"}
            </button>

            {state?.error ? (
              <StatusMessage tone="error">{state.error}</StatusMessage>
            ) : null}
            {state?.ok ? (
              <StatusMessage tone="success">
                Reward added. It applies the next time a member qualifies.
              </StatusMessage>
            ) : null}
          </form>
        </Panel>
      </div>
    </div>
  );
}

/** The list of existing rewards, with enable and delete. */
function RewardList({ rewards }: { rewards: RewardRow[] }) {
  if (rewards.length === 0) {
    return (
      <EmptyState
        icon={Gift}
        title="No rewards yet"
        description="Add one to give members something for reaching a milestone."
      />
    );
  }

  return (
    <ul className="flex flex-col gap-2.5">
      {rewards.map((reward) => (
        <li
          key={reward.id}
          className={cn(
            "rounded-xl border p-3.5 transition",
            reward.enabled
              ? "border-[color:var(--color-komu-border)] bg-white/[0.015]"
              : "border-[color:var(--color-komu-border)] bg-white/[0.008] opacity-70",
          )}
        >
          <div className="flex flex-wrap items-start gap-3">
            <span
              className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border",
                reward.enabled
                  ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-300"
                  : "border-[color:var(--color-komu-border-muted)] bg-white/[0.02] text-[color:var(--color-komu-dim)]",
              )}
            >
              <Gift className="h-[18px] w-[18px]" />
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold text-[color:var(--color-komu-text)]">
                  {reward.name}
                </p>
                <Badge tone={reward.enabled ? "success" : "neutral"}>
                  {reward.enabled ? "Active" : "Paused"}
                </Badge>
                {reward.repeatable ? <Badge tone="violet">Repeatable</Badge> : null}
              </div>

              {reward.description ? (
                <p className="mt-0.5 text-[11px] leading-5 text-[color:var(--color-komu-muted)]">
                  {reward.description}
                </p>
              ) : null}

              <p className="mt-1.5 text-[11px] text-[color:var(--color-komu-muted)]">
                At{" "}
                <span className="font-semibold text-[color:var(--color-komu-text)]">
                  {reward.threshold.toLocaleString()} {reward.metricLabel}
                </span>{" "}
                <span className="text-[color:var(--color-komu-dim)]">→</span>
              </p>

              <div className="mt-2 flex flex-wrap gap-1.5">
                {reward.actions.map((action) => (
                  <span
                    key={action}
                    className="rounded-md border border-indigo-400/20 bg-indigo-500/[0.07] px-2 py-1 text-[10px] font-medium text-indigo-200"
                  >
                    {action}
                  </span>
                ))}
              </div>
            </div>

            <div className="flex w-full shrink-0 items-center justify-end gap-2 sm:w-auto">
              <span className="mr-1 inline-flex items-center gap-1 text-[10px] text-[color:var(--color-komu-dim)]">
                <Users className="h-3 w-3" />
                {reward.grantCount.toLocaleString()}
              </span>
              <form action={toggleRewardAction.bind(null, reward.id)}>
                <button type="submit" className="komu-btn komu-btn-secondary min-h-8 px-2.5 py-1 text-[11px]">
                  {reward.enabled ? "Pause" : "Enable"}
                </button>
              </form>
              <ConfirmButton
                action={deleteRewardAction.bind(null, reward.id)}
                question="This reward and its history will be removed."
              />
            </div>
          </div>
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
    <div className="grid gap-3 sm:grid-cols-2">
      <FormField label="Action">
        <select
          name="actionType"
          value={selected}
          onChange={(event) => setSelected(event.target.value)}
          className="komu-input"
        >
          {actionTypes.map((action) => (
            <option key={action.value} value={action.value}>
              {action.label}
            </option>
          ))}
        </select>
      </FormField>

      {selected === "GIVE_XP" ? (
        <FormField label="XP amount">
          <input
            name="xpAmount"
            type="number"
            min={1}
            defaultValue={500}
            required
            className="komu-input"
          />
        </FormField>
      ) : null}

      {selected === "ADD_ROLE" || selected === "REMOVE_ROLE" ? (
        <FormField label="Role">
          <select
            name="roleId"
            required
            defaultValue=""
            className="komu-input"
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
        </FormField>
      ) : null}

      {selected === "UNLOCK_ACHIEVEMENT" ? (
        <FormField label="Achievement">
          <select
            name="achievementId"
            required
            defaultValue=""
            className="komu-input"
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
        </FormField>
      ) : null}
    </div>
  );
}

"use client";

import { useActionState } from "react";

import {
  createRoleRuleAction,
  deleteRoleRuleAction,
  INITIAL_ROLE_STATE,
  toggleRoleRuleAction,
  type RoleFormState,
} from "./actions";

interface RoleOption {
  id: string;
  label: string;
  position: number;
}

interface RuleRow {
  id: string;
  name: string;
  metric: string;
  threshold: number;
  roleName: string;
  enabled: boolean;
}

const METRIC_LABELS: Record<string, string> = {
  LEVEL: "Level reached",
  XP: "Total XP reached",
  MESSAGE_COUNT: "Messages sent",
  MEMBER_AGE_DAYS: "Days in server",
};

/** Create a rule, and list the existing ones with enable and delete. */
export function RoleRuleManager({
  roles,
  rules,
  availableMetrics,
}: {
  roles: RoleOption[];
  rules: RuleRow[];
  availableMetrics: string[];
}) {
  const [state, formAction, pending] = useActionState<RoleFormState, FormData>(
    createRoleRuleAction,
    INITIAL_ROLE_STATE,
  );

  return (
    <div className="flex flex-col gap-8">
      {rules.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {rules.map((rule) => (
            <li
              key={rule.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] p-4"
            >
              <span className={rule.enabled ? "" : "opacity-50"}>
                <span className="font-medium">{rule.name}</span>
                <span className="ml-2 text-sm text-[color:var(--color-komu-muted)]">
                  {METRIC_LABELS[rule.metric] ?? rule.metric} {rule.threshold}+
                  {" -> "}@{rule.roleName}
                </span>
              </span>

              <span className="ml-auto flex gap-2">
                <form action={toggleRoleRuleAction.bind(null, rule.id)}>
                  <button
                    type="submit"
                    className="rounded-md border border-[color:var(--color-komu-border)] px-3 py-1.5 text-sm hover:bg-[color:var(--color-komu-surface-raised)]"
                  >
                    {rule.enabled ? "Disable" : "Enable"}
                  </button>
                </form>

                <form action={deleteRoleRuleAction.bind(null, rule.id)}>
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
      ) : (
        <p className="rounded-lg border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] p-4 text-sm text-[color:var(--color-komu-muted)]">
          No role rules yet. Add one below to reward activity automatically.
        </p>
      )}

      <form action={formAction} className="flex flex-col gap-3">
        <h2 className="font-semibold">Add a rule</h2>

        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs tracking-wider text-[color:var(--color-komu-muted)] uppercase">
              Name
            </span>
            <input
              name="name"
              required
              placeholder="Veteran"
              className="w-44 rounded-md border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] px-3 py-2"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs tracking-wider text-[color:var(--color-komu-muted)] uppercase">
              When
            </span>
            <select
              name="metric"
              defaultValue={availableMetrics[0]}
              className="rounded-md border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] px-3 py-2"
            >
              {availableMetrics.map((metric) => (
                <option key={metric} value={metric}>
                  {METRIC_LABELS[metric] ?? metric}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs tracking-wider text-[color:var(--color-komu-muted)] uppercase">
              Threshold
            </span>
            <input
              name="threshold"
              type="number"
              min={0}
              defaultValue={10}
              required
              className="w-28 rounded-md border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] px-3 py-2"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs tracking-wider text-[color:var(--color-komu-muted)] uppercase">
              Give role
            </span>
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
          </label>

          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-[color:var(--color-komu-accent)] px-5 py-2 font-medium text-white transition hover:bg-[color:var(--color-komu-accent-hover)] disabled:opacity-60"
          >
            {pending ? "Adding..." : "Add rule"}
          </button>
        </div>

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
            Rule added. It applies the next time a member qualifies.
          </p>
        ) : null}
      </form>
    </div>
  );
}
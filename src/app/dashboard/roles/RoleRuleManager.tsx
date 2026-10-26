"use client";

import { BadgeCheck, Plus, Settings2 } from "lucide-react";
import { useActionState } from "react";

import {
  Badge,
  EmptyState,
  FormField,
  Panel,
  StatusMessage,
  cn,
} from "@/components/dashboard/ui";
import { ConfirmButton } from "@/components/dashboard/ConfirmButton";
import {
  createRoleRuleAction,
  deleteRoleRuleAction,
  toggleRoleRuleAction,
  type RoleFormState,
} from "./actions";

/**
 * Declared here rather than in actions.ts because a "use server" file may only
 * export async functions, and the Client Component imports this value at
 * runtime.
 */
const INITIAL_ROLE_STATE: RoleFormState = {};

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

  const active = rules.filter((rule) => rule.enabled).length;

  return (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
      <Panel
        title="Automation rules"
        description="Every rule is checked when a member chats or joins."
        icon={BadgeCheck}
        action={<Badge tone={active > 0 ? "success" : "neutral"}>{active} active</Badge>}
      >
        {rules.length === 0 ? (
          <EmptyState
            icon={BadgeCheck}
            title="No role rules yet"
            description="Add a rule to reward activity automatically. Roles already granted are never removed by a rule."
          />
        ) : (
          <ul className="flex flex-col gap-2.5">
            {rules.map((rule) => (
              <li
                key={rule.id}
                className={cn(
                  "rounded-xl border p-3.5 transition",
                  rule.enabled
                    ? "border-[color:var(--color-komu-border)] bg-white/[0.015]"
                    : "border-[color:var(--color-komu-border)] bg-white/[0.008] opacity-70",
                )}
              >
                <div className="flex flex-wrap items-start gap-3">
                  <span
                    className={cn(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border",
                      rule.enabled
                        ? "border-violet-400/25 bg-violet-500/10 text-violet-300"
                        : "border-[color:var(--color-komu-border-muted)] bg-white/[0.02] text-[color:var(--color-komu-dim)]",
                    )}
                  >
                    <BadgeCheck className="h-[18px] w-[18px]" />
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-[color:var(--color-komu-text)]">
                        {rule.name}
                      </p>
                      <Badge tone={rule.enabled ? "success" : "neutral"}>
                        {rule.enabled ? "Active" : "Paused"}
                      </Badge>
                    </div>
                    <p className="mt-1 text-[11px] leading-5 text-[color:var(--color-komu-muted)]">
                      {METRIC_LABELS[rule.metric] ?? rule.metric} ≥{" "}
                      <span className="font-semibold text-[color:var(--color-komu-text)]">
                        {rule.threshold.toLocaleString()}
                      </span>{" "}
                      <span className="text-[color:var(--color-komu-dim)]">→</span>{" "}
                      <span className="rounded border border-violet-400/20 bg-violet-500/[0.07] px-1.5 py-0.5 font-medium text-violet-200">
                        @{rule.roleName}
                      </span>
                    </p>
                  </div>

                  <div className="flex w-full shrink-0 items-center justify-end gap-2 sm:w-auto">
                    <form action={toggleRoleRuleAction.bind(null, rule.id)}>
                      <button type="submit" className="komu-btn komu-btn-secondary min-h-8 px-2.5 py-1 text-[11px]">
                        {rule.enabled ? "Pause" : "Enable"}
                      </button>
                    </form>
                    <ConfirmButton
                      action={deleteRoleRuleAction.bind(null, rule.id)}
                      label="Delete"
                      question="This rule will be removed. Roles already granted stay."
                      className="komu-btn komu-btn-danger min-h-8 px-2.5 py-1 text-[11px]"
                    />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 flex items-start gap-2 border-t border-[color:var(--color-komu-border)] pt-3 text-[10px] leading-4 text-[color:var(--color-komu-dim)]">
          <Settings2 className="mt-0.5 h-3 w-3 shrink-0" />
          A role above the bot&apos;s highest role cannot be assigned. Check the
          bot logs if a rule never fires.
        </div>
      </Panel>

      <div className="xl:sticky xl:top-24">
        <Panel
          title="Create a rule"
          description="Set one milestone and the role it unlocks."
          icon={Plus}
        >
          <form action={formAction} className="flex flex-col gap-3">
            <FormField label="Rule name" hint="A label for the dashboard.">
              <input
                name="name"
                required
                placeholder="Veteran"
                className="komu-input"
              />
            </FormField>

            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="Signal">
                <select
                  name="metric"
                  defaultValue={availableMetrics[0]}
                  className="komu-input"
                >
                  {availableMetrics.map((metric) => (
                    <option key={metric} value={metric}>
                      {METRIC_LABELS[metric] ?? metric}
                    </option>
                  ))}
                </select>
              </FormField>

              <FormField label="Threshold">
                <input
                  name="threshold"
                  type="number"
                  min={0}
                  defaultValue={10}
                  required
                  className="komu-input"
                />
              </FormField>
            </div>

            <FormField label="Give role" hint="The role must sit below the bot's highest role.">
              <select name="roleId" required defaultValue="" className="komu-input">
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

            <button
              type="submit"
              disabled={pending}
              className="komu-btn komu-btn-primary mt-1"
            >
              <Plus className="h-4 w-4" />
              {pending ? "Adding…" : "Add rule"}
            </button>

            {state?.error ? (
              <StatusMessage tone="error">{state.error}</StatusMessage>
            ) : null}
            {state?.ok ? (
              <StatusMessage tone="success">
                Rule added. It applies the next time a member qualifies.
              </StatusMessage>
            ) : null}
          </form>
        </Panel>
      </div>
    </div>
  );
}

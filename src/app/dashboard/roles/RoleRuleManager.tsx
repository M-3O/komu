"use client";

import { BadgeCheck, Pencil, Plus, Settings2 } from "lucide-react";
import { useActionState, useEffect, useState } from "react";

import {
  Badge,
  EmptyState,
  FormField,
  Panel,
  StatusMessage,
  cn,
} from "@/components/dashboard/ui";
import { ConfirmButton } from "@/components/dashboard/ConfirmButton";
import { INPUT_LIMITS } from "@/lib/validation/limits";
import {
  createRoleRuleAction,
  deleteRoleRuleAction,
  toggleRoleRuleAction,
  updateRoleRuleAction,
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
  roleId: string;
  roleName: string;
  enabled: boolean;
}

const METRIC_LABELS: Record<string, string> = {
  LEVEL: "Level reached",
  XP: "Total XP reached",
  MESSAGE_COUNT: "Messages sent",
  STREAM_ATTENDANCE: "Streams attended",
  WATCH_TIME_HOURS: "Hours watched",
  MEMBER_AGE_DAYS: "Days in server",
};

/** Create a rule, and list, edit, pause or delete the existing ones. */
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
  const [editingId, setEditingId] = useState<string | null>(null);

  const active = rules.filter((rule) => rule.enabled).length;

  return (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
      <Panel
        title="Automation rules"
        description="Every rule is checked when a member chats or joins. Edit a name, signal or threshold without recreating it."
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

                  <div className="flex w-full shrink-0 flex-wrap items-center justify-end gap-2 sm:w-auto">
                    <button
                      type="button"
                      onClick={() =>
                        setEditingId((current) =>
                          current === rule.id ? null : rule.id,
                        )
                      }
                      aria-expanded={editingId === rule.id}
                      className="komu-btn komu-btn-secondary min-h-8 px-2.5 py-1 text-[11px]"
                    >
                      <Pencil className="h-3 w-3" />
                      {editingId === rule.id ? "Close" : "Edit"}
                    </button>
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

                {editingId === rule.id ? (
                  <EditRuleForm
                    key={rule.id}
                    rule={rule}
                    roles={roles}
                    availableMetrics={availableMetrics}
                    onClose={() => setEditingId(null)}
                  />
                ) : null}
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
            <RuleFields
              roles={roles}
              availableMetrics={availableMetrics}
            />

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

/**
 * Shared fields for creating and editing.
 *
 * A rule can be renamed, its XP threshold (or other signal) changed, and its
 * assigned role swapped. All of it goes through the same server-side
 * validation as creation, so "the streamer can change anything" does not mean
 * "the browser can post anything".
 */
function RuleFields({
  roles,
  availableMetrics,
  defaults,
}: {
  roles: RoleOption[];
  availableMetrics: string[];
  defaults?: RuleRow;
}) {
  const currentRoleMissing =
    defaults !== undefined &&
    !roles.some((role) => role.id === defaults.roleId);

  return (
    <>
      <FormField
        label="Rule name"
        hint="A dashboard label. The Discord role name stays as it is in Discord."
      >
        <input
          name="name"
          required
          maxLength={INPUT_LIMITS.name}
          defaultValue={defaults?.name}
          placeholder="Veteran"
          className="komu-input"
        />
      </FormField>

      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Signal">
          <select
            name="metric"
            defaultValue={defaults?.metric ?? availableMetrics[0]}
            className="komu-input"
          >
            {availableMetrics.map((metric) => (
              <option key={metric} value={metric}>
                {METRIC_LABELS[metric] ?? metric}
              </option>
            ))}
          </select>
        </FormField>

        <FormField
          label="Threshold"
          hint="For Total XP, use the lifetime XP total."
        >
          <input
            name="threshold"
            type="number"
            min={0}
            max={INPUT_LIMITS.threshold}
            defaultValue={defaults?.threshold ?? 10}
            required
            className="komu-input"
          />
        </FormField>
      </div>

      <FormField
        label="Give role"
        hint="The role must sit below the bot's highest role."
      >
        <select
          name="roleId"
          required
          defaultValue={defaults?.roleId ?? ""}
          className="komu-input"
        >
          <option value="" disabled>
            Choose a role
          </option>
          {currentRoleMissing && defaults ? (
            <option value={defaults.roleId} disabled>
              @{defaults.roleName} (not available in Discord)
            </option>
          ) : null}
          {roles.map((role) => (
            <option key={role.id} value={role.id}>
              {role.label}
            </option>
          ))}
        </select>
      </FormField>
    </>
  );
}

function EditRuleForm({
  rule,
  roles,
  availableMetrics,
  onClose,
}: {
  rule: RuleRow;
  roles: RoleOption[];
  availableMetrics: string[];
  onClose: () => void;
}) {
  const [state, formAction, pending] = useActionState<RoleFormState, FormData>(
    updateRoleRuleAction,
    INITIAL_ROLE_STATE,
  );

  useEffect(() => {
    if (state?.ok) onClose();
  }, [state?.ok, onClose]);

  return (
    <form
      action={formAction}
      className="mt-3 flex flex-col gap-3 rounded-lg border border-[color:var(--color-komu-border-muted)] bg-[color:var(--color-komu-bg-deep)]/60 p-3"
    >
      <input type="hidden" name="ruleId" value={rule.id} />

      <RuleFields
        roles={roles}
        availableMetrics={availableMetrics}
        defaults={rule}
      />

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="komu-btn komu-btn-primary min-h-8 px-3 py-1 text-[11px]"
        >
          {pending ? "Saving…" : "Save changes"}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="komu-btn komu-btn-secondary min-h-8 px-3 py-1 text-[11px]"
        >
          Cancel
        </button>
      </div>

      {state?.error ? (
        <StatusMessage tone="error">{state.error}</StatusMessage>
      ) : null}
    </form>
  );
}

"use client";

import { Activity, Clock, Filter, Plus, Shield } from "lucide-react";
import { useActionState, useState } from "react";

import { ConfirmButton } from "@/components/dashboard/ConfirmButton";
import {
  Badge,
  EmptyState,
  FormField,
  Panel,
  StatusMessage,
  cn,
  formatDateTime,
  initials,
} from "@/components/dashboard/ui";
import {
  createModerationRuleAction,
  deleteModerationRuleAction,
  toggleModerationRuleAction,
  type ModerationFormState,
} from "./actions";

/**
 * Declared here rather than in actions.ts because a "use server" file may only
 * export async functions, and the Client Component imports this value at
 * runtime.
 */
const INITIAL_MODERATION_STATE: ModerationFormState = {};

interface ChannelOption {
  id: string;
  label: string;
}

interface TypeOption {
  value: string;
  label: string;
  actions: Array<{ value: string; label: string }>;
}

interface RuleRow {
  id: string;
  name: string;
  enabled: boolean;
  summary: string;
  logChannel: string | null;
  triggerCount: number;
}

interface LogRow {
  username: string;
  type: string;
  reason: string | null;
  moderator: string;
  createdAt: string;
}

/** Create and manage moderation rules, and see what they have caught. */
export function ModerationManager({
  rules,
  channels,
  types,
  log,
}: {
  rules: RuleRow[];
  channels: ChannelOption[];
  types: TypeOption[];
  log: LogRow[];
}) {
  const [state, formAction, pending] = useActionState<ModerationFormState, FormData>(
    createModerationRuleAction,
    INITIAL_MODERATION_STATE,
  );

  const active = rules.filter((rule) => rule.enabled).length;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_430px]">
        <Panel
          title="Protection rules"
          description="Checked on every message and every join."
          icon={Shield}
          action={<Badge tone={active > 0 ? "success" : "neutral"}>{active} active</Badge>}
        >
          <RuleList rules={rules} />
        </Panel>

        <div className="xl:sticky xl:top-24">
          <Panel
            title="Create a rule"
            description="Pick one signal and the action it triggers."
            icon={Plus}
          >
            <form action={formAction} className="flex flex-col gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField label="Rule name">
                  <input
                    name="name"
                    required
                    placeholder="Word filter"
                    className="komu-input"
                  />
                </FormField>

                <FormField label="Log to channel">
                  <select
                    name="logChannelId"
                    defaultValue=""
                    className="komu-input"
                  >
                    <option value="">No channel</option>
                    {channels.map((channel) => (
                      <option key={channel.id} value={channel.id}>
                        {channel.label}
                      </option>
                    ))}
                  </select>
                </FormField>
              </div>

              <div className="rounded-xl border border-[color:var(--color-komu-border)] bg-white/[0.015] p-3">
                <RuleFields types={types} />
              </div>

              <button
                type="submit"
                disabled={pending}
                className="komu-btn komu-btn-primary"
              >
                <Plus className="h-4 w-4" />
                {pending ? "Adding…" : "Add rule"}
              </button>

              {state?.error ? (
                <StatusMessage tone="error">{state.error}</StatusMessage>
              ) : null}
              {state?.ok ? (
                <StatusMessage tone="success">
                  Rule added. It applies to the next matching message or join.
                </StatusMessage>
              ) : null}
            </form>
          </Panel>
        </div>
      </div>

      <Panel
        title="Recent moderation"
        description="The latest actions taken by rules or moderators."
        icon={Activity}
        action={<Badge tone="neutral">{log.length} recent</Badge>}
        flush
      >
        <LogList log={log} />
      </Panel>
    </div>
  );
}

function RuleList({ rules }: { rules: RuleRow[] }) {
  if (rules.length === 0) {
    return (
      <EmptyState
        icon={Shield}
        title="No moderation rules yet"
        description="Add one to filter words, limit spam, or protect against join raids automatically."
      />
    );
  }

  return (
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
                  ? "border-emerald-400/20 bg-emerald-500/[0.08] text-emerald-300"
                  : "border-[color:var(--color-komu-border-muted)] bg-white/[0.02] text-[color:var(--color-komu-dim)]",
              )}
            >
              <Shield className="h-[18px] w-[18px]" />
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
                {rule.summary}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-[color:var(--color-komu-dim)]">
                <span className="inline-flex items-center gap-1">
                  <Activity className="h-3 w-3" />
                  {rule.triggerCount.toLocaleString()} action
                  {rule.triggerCount === 1 ? "" : "s"}
                </span>
                {rule.logChannel ? (
                  <span className="inline-flex items-center gap-1">
                    <Filter className="h-3 w-3" />
                    logs to #{rule.logChannel}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    no log channel
                  </span>
                )}
              </div>
            </div>

            <div className="flex w-full shrink-0 items-center justify-end gap-2 sm:w-auto">
              <form action={toggleModerationRuleAction.bind(null, rule.id)}>
                <button
                  type="submit"
                  className="komu-btn komu-btn-secondary min-h-8 px-2.5 py-1 text-[11px]"
                >
                  {rule.enabled ? "Pause" : "Enable"}
                </button>
              </form>
              <ConfirmButton
                action={deleteModerationRuleAction.bind(null, rule.id)}
                question="This rule will be removed. Past actions stay in the log."
              />
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * The rule type and its action, plus only the fields that type uses.
 *
 * Each control has exactly one field name. Rendering a second control for the
 * same field would be silently ignored, because formData.get() returns the
 * first match and the server action would validate against the wrong value.
 *
 * Fields for other types are simply not submitted, and the action validates
 * only the ones its own type needs.
 */
function RuleFields({ types }: { types: TypeOption[] }) {
  const [selected, setSelected] = useState(types[0]?.value ?? "");
  const [action, setAction] = useState(types[0]?.actions[0]?.value ?? "");

  const actions =
    types.find((type) => type.value === selected)?.actions ??
    types[0]?.actions ??
    [];

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Watches for">
          <select
            name="type"
            value={selected}
            onChange={(event) => {
              setSelected(event.target.value);
              const next = types.find((type) => type.value === event.target.value);
              setAction(next?.actions[0]?.value ?? "");
            }}
            className="komu-input"
          >
            {types.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
        </FormField>

        <FormField label="Action">
          <select
            name="action"
            value={action}
            onChange={(event) => setAction(event.target.value)}
            className="komu-input"
          >
            {actions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </FormField>

        {action === "TIMEOUT" ? (
          <FormField label="Timeout minutes">
            <input
              name="actionDurationMins"
              type="number"
              min={1}
              defaultValue={10}
              required
              className="komu-input"
            />
          </FormField>
        ) : null}
      </div>

      {selected === "WORD_FILTER" ? (
        <>
          <FormField
            label="Blocked words or phrases"
            hint="Comma or newline separated."
          >
            <textarea
              name="blockedWords"
              rows={3}
              required
              placeholder={"badword, spam-link\nfree nitro"}
              className="komu-input"
            />
          </FormField>

          <ToggleRow
            name="warnOnMatch"
            label="Also warn the member"
            hint="A note is sent in the channel before the action is recorded."
          />
        </>
      ) : null}

      {selected === "SPAM" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Messages allowed">
            <input
              name="messageLimit"
              type="number"
              min={1}
              defaultValue={5}
              required
              className="komu-input"
            />
          </FormField>

          <FormField label="Within seconds">
            <input
              name="windowSeconds"
              type="number"
              min={60}
              max={600}
              defaultValue={30}
              required
              className="komu-input"
            />
          </FormField>
        </div>
      ) : null}

      {selected === "RAID_PROTECTION" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Joins that trigger it">
            <input
              name="joinThreshold"
              type="number"
              min={1}
              defaultValue={5}
              required
              className="komu-input"
            />
          </FormField>

          <FormField label="Within seconds">
            <input
              name="joinWindowSeconds"
              type="number"
              min={5}
              max={900}
              defaultValue={30}
              required
              className="komu-input"
            />
          </FormField>
        </div>
      ) : null}
    </div>
  );
}

function LogList({ log }: { log: LogRow[] }) {
  if (log.length === 0) {
    return (
      <div className="p-5 sm:p-6">
        <EmptyState
          icon={Activity}
          title="Nothing has been actioned yet"
          description="A rule only appears here when it catches something."
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
            <th>Action</th>
            <th>Reason</th>
            <th>Source</th>
            <th className="pr-5 text-right">When</th>
          </tr>
        </thead>
        <tbody>
          {log.map((entry) => (
            <tr key={`${entry.username}-${entry.createdAt}-${entry.type}`}>
              <td className="pl-5">
                <div className="flex items-center gap-2">
                  <span className="komu-avatar komu-avatar-sm" aria-hidden>
                    {initials(entry.username)}
                  </span>
                  <span className="text-xs font-medium text-[color:var(--color-komu-text)]">
                    {entry.username}
                  </span>
                </div>
              </td>
              <td>
                <Badge tone={logActionTone(entry.type)}>
                  {actionLabel(entry.type)}
                </Badge>
              </td>
              <td className="max-w-[280px]">
                <span className="line-clamp-2 text-[11px] leading-5 text-[color:var(--color-komu-muted)]">
                  {entry.reason ?? "No reason recorded"}
                </span>
              </td>
              <td className="text-[11px] text-[color:var(--color-komu-muted)]">
                {entry.moderator === "SYSTEM" ? "Komu" : entry.moderator}
              </td>
              <td className="pr-5 text-right text-[10px] text-[color:var(--color-komu-dim)]">
                {formatDateTime(entry.createdAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ToggleRow({
  name,
  label,
  hint,
}: {
  name: string;
  label: string;
  hint: string;
}) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-lg border border-[color:var(--color-komu-border)] bg-white/[0.015] px-3 py-2">
      <span>
        <span className="block text-xs font-medium text-[color:var(--color-komu-text)]">
          {label}
        </span>
        <span className="mt-0.5 block text-[10px] leading-4 text-[color:var(--color-komu-dim)]">
          {hint}
        </span>
      </span>
      <input type="checkbox" name={name} className="komu-switch" />
    </label>
  );
}

function actionLabel(type: string): string {
  return type
    .split("_")
    .map((word) => `${word[0] ?? ""}${word.slice(1).toLowerCase()}`)
    .join(" ");
}

function logActionTone(type: string): "danger" | "warning" | "accent" | "neutral" {
  if (type === "BAN" || type === "KICK" || type === "DELETE_MESSAGE") {
    return "danger";
  }
  if (type === "TIMEOUT" || type === "WARN") return "warning";
  if (type === "MUTE") return "accent";
  return "neutral";
}

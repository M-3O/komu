"use client";

import { useActionState, useState } from "react";

import {
  createModerationRuleAction,
  deleteModerationRuleAction,
  INITIAL_MODERATION_STATE,
  toggleModerationRuleAction,
  type ModerationFormState,
} from "./actions";

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

  return (
    <div className="flex flex-col gap-8">
      <RuleList rules={rules} />

      <form action={formAction} className="flex flex-col gap-4">
        <h2 className="font-semibold">Add a rule</h2>

        <div className="flex flex-wrap items-end gap-3">
          <Field label="Name">
            <input
              name="name"
              required
              placeholder="Word filter"
              className="w-44 rounded-md border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] px-3 py-2"
            />
          </Field>

          <Field label="Log to channel">
            <select
              name="logChannelId"
              defaultValue=""
              className="rounded-md border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] px-3 py-2"
            >
              <option value="">No channel</option>
              {channels.map((channel) => (
                <option key={channel.id} value={channel.id}>
                  {channel.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <RuleFields types={types} />

        <button
          type="submit"
          disabled={pending}
          className="self-start rounded-lg bg-[color:var(--color-komu-accent)] px-5 py-2 font-medium text-white transition hover:bg-[color:var(--color-komu-accent-hover)] disabled:opacity-60"
        >
          {pending ? "Adding..." : "Add rule"}
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
            Rule added. It applies to the next matching message or join.
          </p>
        ) : null}
      </form>

      <LogList log={log} />
    </div>
  );
}

function RuleList({ rules }: { rules: RuleRow[] }) {
  if (rules.length === 0) {
    return (
      <p className="rounded-lg border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] p-4 text-sm text-[color:var(--color-komu-muted)]">
        No moderation rules yet. Add one below to filter, rate-limit or protect
        against raids automatically.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {rules.map((rule) => (
        <li
          key={rule.id}
          className="flex flex-wrap items-center gap-3 rounded-lg border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] p-4"
        >
          <span className={rule.enabled ? "" : "opacity-50"}>
            <span className="font-medium">{rule.name}</span>
            <span className="block text-sm text-[color:var(--color-komu-muted)]">
              {rule.summary}
            </span>
            <span className="block text-xs text-[color:var(--color-komu-muted)]">
              {rule.triggerCount} action{rule.triggerCount === 1 ? "" : "s"}
              {rule.logChannel ? ` · logs to ${rule.logChannel}` : ""}
            </span>
          </span>

          <span className="ml-auto flex gap-2">
            <form action={toggleModerationRuleAction.bind(null, rule.id)}>
              <button
                type="submit"
                className="rounded-md border border-[color:var(--color-komu-border)] px-3 py-1.5 text-sm hover:bg-[color:var(--color-komu-surface-raised)]"
              >
                {rule.enabled ? "Disable" : "Enable"}
              </button>
            </form>

            <form action={deleteModerationRuleAction.bind(null, rule.id)}>
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

  const actions = types.find((type) => type.value === selected)?.actions ?? types[0]?.actions ?? [];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Watches for">
          <select
            name="type"
            value={selected}
            onChange={(event) => {
              setSelected(event.target.value);
              const next = types.find((type) => type.value === event.target.value);
              setAction(next?.actions[0]?.value ?? "");
            }}
            className="rounded-md border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] px-3 py-2"
          >
            {types.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Action">
          <select
            name="action"
            value={action}
            onChange={(event) => setAction(event.target.value)}
            className="rounded-md border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] px-3 py-2"
          >
            {actions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>

        {action === "TIMEOUT" ? (
          <Field label="Timeout minutes">
            <input
              name="actionDurationMins"
              type="number"
              min={1}
              defaultValue={10}
              required
              className="w-28 rounded-md border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] px-3 py-2"
            />
          </Field>
        ) : null}
      </div>

      {selected === "WORD_FILTER" ? (
        <Field label="Blocked words or phrases (comma or newline separated)">
          <textarea
            name="blockedWords"
            rows={3}
            required
            placeholder={"badword, spam-link\nfree nitro"}
            className="w-full rounded-md border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] px-3 py-2"
          />
        </Field>
      ) : null}

      {selected === "WORD_FILTER" ? (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="warnOnMatch" />
          Also warn the member
        </label>
      ) : null}

      {selected === "SPAM" ? (
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Messages allowed">
            <input
              name="messageLimit"
              type="number"
              min={1}
              defaultValue={5}
              required
              className="w-28 rounded-md border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] px-3 py-2"
            />
          </Field>

          <Field label="Within seconds">
            <input
              name="windowSeconds"
              type="number"
              min={60}
              max={600}
              defaultValue={30}
              required
              className="w-28 rounded-md border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] px-3 py-2"
            />
          </Field>
        </div>
      ) : null}

      {selected === "RAID_PROTECTION" ? (
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Joins that trigger it">
            <input
              name="joinThreshold"
              type="number"
              min={1}
              defaultValue={5}
              required
              className="w-28 rounded-md border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] px-3 py-2"
            />
          </Field>

          <Field label="Within seconds">
            <input
              name="joinWindowSeconds"
              type="number"
              min={5}
              max={900}
              defaultValue={30}
              required
              className="w-28 rounded-md border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] px-3 py-2"
            />
          </Field>
        </div>
      ) : null}
    </div>
  );
}

function LogList({ log }: { log: LogRow[] }) {
  if (log.length === 0) {
    return (
      <p className="rounded-lg border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] p-4 text-sm text-[color:var(--color-komu-muted)]">
        Nothing has been actioned yet.
      </p>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-semibold">Recent moderation</h2>

      <ul className="flex flex-col gap-1">
        {log.map((entry) => (
          <li
            key={`${entry.username}-${entry.createdAt}-${entry.type}`}
            className="rounded-md border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] px-4 py-2 text-sm"
          >
            <span className="font-medium">{entry.username}</span>
            <span className="text-[color:var(--color-komu-muted)]">
              {" — "}
              {entry.type.replace(/_/g, " ").toLowerCase()}
              {entry.reason ? ` · ${entry.reason}` : ""}
              {" · by "}
              {entry.moderator === "SYSTEM" ? "Komu" : entry.moderator}
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
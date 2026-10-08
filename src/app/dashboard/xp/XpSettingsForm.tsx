"use client";

import { useActionState, useState } from "react";

import {
  INITIAL_XP_STATE,
  updateXpSettingsAction,
  type XpFormState,
} from "./actions";
import { capIsTheBindingLimit, cooldownMinutes, messagesPerDay } from "@/lib/xp/settings";

interface XpSettings {
  xpEnabled: boolean;
  xpMessageAmount: number;
  xpMessageMinLength: number;
  xpMessageCooldownSecs: number;
  xpDailyCap: number;
}

/**
 * The XP settings form.
 *
 * The implications panel updates as the numbers are typed, so a creator sees
 * what a daily cap actually allows before saving rather than discovering it
 * later. That is more useful than refusing a low cap, which a creator may well
 * have chosen on purpose.
 */
export function XpSettingsForm({
  settings,
}: {
  settings: XpSettings;
}) {
  const [state, formAction, pending] = useActionState<XpFormState, FormData>(
    updateXpSettingsAction,
    INITIAL_XP_STATE,
  );

  const [amount, setAmount] = useState(String(settings.xpMessageAmount));
  const [minLength, setMinLength] = useState(String(settings.xpMessageMinLength));
  const [cooldown, setCooldown] = useState(String(settings.xpMessageCooldownSecs));
  const [cap, setCap] = useState(String(settings.xpDailyCap));
  const [enabled, setEnabled] = useState(settings.xpEnabled);

  const preview = {
    xpEnabled: enabled,
    xpMessageAmount: Number.parseInt(amount, 10),
    xpMessageMinLength: Number.parseInt(minLength, 10),
    xpMessageCooldownSecs: Number.parseInt(cooldown, 10),
    xpDailyCap: Number.parseInt(cap, 10),
  };

  const perDay = messagesPerDay(preview);
  const capped = capIsTheBindingLimit(preview);

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="xpEnabled"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
        />
        Award XP for community activity
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <NumberField
          label="XP per message"
          name="xpMessageAmount"
          value={amount}
          onChange={setAmount}
          min={1}
          help="What a qualifying message earns. Members see this on /level."
          problem={state?.problems?.xpMessageAmount}
        />

        <NumberField
          label="Minimum message length"
          name="xpMessageMinLength"
          value={minLength}
          onChange={setMinLength}
          min={1}
          help="Shorter messages earn nothing. Filters out 'lol' and emoji spam."
          problem={state?.problems?.xpMessageMinLength}
        />

        <NumberField
          label="Cooldown between messages (seconds)"
          name="xpMessageCooldownSecs"
          value={cooldown}
          onChange={setCooldown}
          min={0}
          help="How long before a member's next message can earn XP again. Zero turns it off."
          problem={state?.problems?.xpMessageCooldownSecs}
        />

        <NumberField
          label="Daily XP cap"
          name="xpDailyCap"
          value={cap}
          onChange={setCap}
          min={0}
          help="Most XP one member can earn in a day. Zero means no limit."
          problem={state?.problems?.xpDailyCap}
        />
      </div>

      <section className="rounded-lg border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] p-4">
        <h2 className="text-sm font-semibold">With these settings</h2>
        <ul className="mt-2 flex list-inside list-disc flex-col gap-1 text-sm text-[color:var(--color-komu-muted)]">
          <li>
            A message of at least {Math.max(preview.xpMessageMinLength, 1)} characters earns{" "}
            {Number.isFinite(preview.xpMessageAmount) ? preview.xpMessageAmount : 0} XP.
          </li>
          <li>
            A member can earn again after{" "}
            {preview.xpMessageCooldownSecs > 0
              ? `${cooldownMinutes(preview.xpMessageCooldownSecs)} minutes`
              : "no wait at all"}
            .
          </li>
          <li>
            That works out to about{" "}
            {perDay === 0 ? "an unlimited number of" : perDay.toLocaleString()}{" "}
            {perDay === 1 ? "message" : "messages"} a member can earn from per day
            {capped ? ", because the daily cap is reached first." : "."}
          </li>
        </ul>

        {!enabled ? (
          <p className="mt-2 text-sm text-[color:var(--color-komu-muted)]">
            XP is switched off, so none of these apply right now. Attendance,
            rewards, challenges and achievements still pay out.
          </p>
        ) : null}
      </section>

      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-lg bg-[color:var(--color-komu-accent)] px-5 py-2 font-medium text-white transition hover:bg-[color:var(--color-komu-accent-hover)] disabled:opacity-60"
      >
        {pending ? "Saving..." : "Save settings"}
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
          Settings saved. They apply to the next qualifying message.
        </p>
      ) : null}
    </form>
  );
}

function NumberField({
  label,
  name,
  value,
  onChange,
  min,
  help,
  problem,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  min: number;
  help: string;
  problem?: string;
}) {
  const invalid = Boolean(problem);

  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs tracking-wider text-[color:var(--color-komu-muted)] uppercase">
        {label}
      </span>
      <input
        name={name}
        type="number"
        min={min}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={invalid}
        aria-describedby={problem ? `${name}-problem` : `${name}-help`}
        className={[
          "w-full rounded-md border bg-[color:var(--color-komu-surface)] px-3 py-2",
          invalid
            ? "border-[color:var(--color-komu-live)]"
            : "border-[color:var(--color-komu-border)]",
        ].join(" ")}
      />
      {problem ? (
        <span
          id={`${name}-problem`}
          role="alert"
          className="text-xs text-[color:var(--color-komu-live)]"
        >
          {problem}
        </span>
      ) : (
        <span id={`${name}-help`} className="text-xs text-[color:var(--color-komu-muted)]">
          {help}
        </span>
      )}
    </label>
  );
}
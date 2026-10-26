"use client";

import { Gauge, Save, SlidersHorizontal, Zap } from "lucide-react";
import { useActionState, useState } from "react";

import {
  Badge,
  FormField,
  Panel,
  StatusMessage,
} from "@/components/dashboard/ui";
import { updateXpSettingsAction, type XpFormState } from "./actions";
import {
  capIsTheBindingLimit,
  cooldownMinutes,
  messagesPerDay,
} from "@/lib/xp/settings";

/**
 * Declared here rather than in actions.ts because a "use server" file may only
 * export async functions, and the Client Component imports this value at
 * runtime.
 */
const INITIAL_XP_STATE: XpFormState = {};

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
 * The pacing card updates as the numbers are typed, so a creator sees what a
 * daily cap actually allows before saving rather than discovering it later.
 * That is more useful than refusing a low cap, which a creator may well have
 * chosen on purpose.
 */
export function XpSettingsForm({ settings }: { settings: XpSettings }) {
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
  const amountValue = Number.isFinite(preview.xpMessageAmount)
    ? Math.max(preview.xpMessageAmount, 0)
    : 0;
  const dailyPotential =
    perDay === 0
      ? null
      : perDay * amountValue;
  const dailyCeiling =
    preview.xpDailyCap > 0 && dailyPotential !== null
      ? Math.min(preview.xpDailyCap, dailyPotential)
      : preview.xpDailyCap > 0
        ? preview.xpDailyCap
        : dailyPotential;

  return (
    <form
      action={formAction}
      className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_360px]"
    >
      <Panel
        title="Earning rules"
        description="Control how chat activity turns into levels."
        icon={SlidersHorizontal}
        action={
          <Badge tone={enabled ? "success" : "warning"} dot={enabled}>
            {enabled ? "XP online" : "XP paused"}
          </Badge>
        }
      >
        <div className="flex flex-col gap-4">
          <label className="flex items-center justify-between gap-3 rounded-xl border border-[color:var(--color-komu-border)] bg-white/[0.015] px-3 py-3">
            <span>
              <span className="block text-xs font-medium text-[color:var(--color-komu-text)]">
                Award XP for community activity
              </span>
              <span className="mt-0.5 block text-[10px] leading-4 text-[color:var(--color-komu-dim)]">
                Switching off stops new awards but keeps existing XP and levels.
              </span>
            </span>
            <input
              type="checkbox"
              name="xpEnabled"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
              className="komu-switch"
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
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
              help="Shorter messages earn nothing. Filters out low-effort spam."
              problem={state?.problems?.xpMessageMinLength}
            />

            <NumberField
              label="Cooldown (seconds)"
              name="xpMessageCooldownSecs"
              value={cooldown}
              onChange={setCooldown}
              min={0}
              help="Wait before the next message can earn XP. Zero turns it off."
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

          <div className="flex flex-wrap items-center gap-2 border-t border-[color:var(--color-komu-border)] pt-4">
            <button
              type="submit"
              disabled={pending}
              className="komu-btn komu-btn-primary"
            >
              <Save className="h-4 w-4" />
              {pending ? "Saving…" : "Save settings"}
            </button>
            <span className="text-[10px] text-[color:var(--color-komu-dim)]">
              Applied to the next qualifying message.
            </span>
          </div>

          {state?.error ? (
            <StatusMessage tone="error">{state.error}</StatusMessage>
          ) : null}
          {state?.ok ? (
            <StatusMessage tone="success">
              Settings saved. They apply to the next qualifying message.
            </StatusMessage>
          ) : null}
        </div>
      </Panel>

      <div className="xl:sticky xl:top-24">
        <Panel
          title="Pacing simulator"
          description="A live estimate from the values you are editing."
          icon={Gauge}
        >
          <div className="rounded-xl border border-indigo-400/20 bg-gradient-to-br from-indigo-500/[0.09] to-violet-500/[0.03] p-4">
            <p className="komu-label">Messages that can earn / day</p>
            <p className="mt-2 font-display text-3xl font-bold tracking-[-0.03em] text-[color:var(--color-komu-text)]">
              {perDay === 0 ? "Unlimited" : perDay.toLocaleString()}
            </p>
            <div className="mt-2 flex items-center gap-2">
              <Zap className="h-3.5 w-3.5 text-indigo-300" />
              <p className="text-[11px] text-[color:var(--color-komu-muted)]">
                About{" "}
                <span className="font-semibold text-[color:var(--color-komu-text)]">
                  {dailyCeiling === null
                    ? "no fixed ceiling"
                    : `${Math.round(dailyCeiling).toLocaleString()} XP`}
                </span>{" "}
                per member per day.
              </p>
            </div>
          </div>

          <dl className="mt-4 flex flex-col gap-2.5">
            <SimRow label="XP per message" value={`${amountValue.toLocaleString()} XP`} />
            <SimRow
              label="Cooldown"
              value={
                preview.xpMessageCooldownSecs > 0
                  ? `${cooldownMinutes(preview.xpMessageCooldownSecs)} min`
                  : "No wait"
              }
            />
            <SimRow
              label="Daily cap"
              value={
                preview.xpDailyCap > 0
                  ? `${preview.xpDailyCap.toLocaleString()} XP`
                  : "No cap"
              }
            />
            <SimRow
              label="Minimum length"
              value={`${Math.max(preview.xpMessageMinLength || 0, 1)} chars`}
            />
          </dl>

          <div className="mt-4 border-t border-[color:var(--color-komu-border)] pt-3">
            <div className="flex items-center justify-between gap-2">
              <span className="komu-label">Binding limit</span>
              <Badge tone={capped ? "warning" : "accent"}>
                {capped ? "Daily cap" : "Cooldown"}
              </Badge>
            </div>
            <p className="mt-2 text-[10px] leading-4 text-[color:var(--color-komu-muted)]">
              {capped
                ? "The daily cap is reached before the cooldown, so raising the cooldown alone changes nothing."
                : "The cooldown is the tighter limit at these values."}
            </p>
          </div>

          {!enabled ? (
            <div className="mt-3">
              <StatusMessage tone="info">
                XP is paused. This simulation is still useful for planning, but
                no message XP is awarded right now.
              </StatusMessage>
            </div>
          ) : null}
        </Panel>
      </div>
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
    <FormField label={label} hint={help} problem={problem}>
      <input
        name={name}
        type="number"
        min={min}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={invalid}
        className="komu-input"
      />
    </FormField>
  );
}

function SimRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <dt className="text-[color:var(--color-komu-muted)]">{label}</dt>
      <dd className="font-medium text-[color:var(--color-komu-text)]">{value}</dd>
    </div>
  );
}

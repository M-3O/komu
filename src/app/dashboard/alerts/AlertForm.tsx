"use client";

import {
  AtSign,
  Hash,
  MessageSquare,
  MousePointerClick,
  Radio,
  Save,
  Send,
} from "lucide-react";
import {
  startTransition,
  useActionState,
  useState,
  type ChangeEvent,
} from "react";

import {
  FormField,
  Panel,
  StatusMessage,
  cn,
} from "@/components/dashboard/ui";
import {
  saveAlertSettingsAction,
  sendTestAlertAction,
  type AlertFormState,
} from "./actions";
import type { AlertDefaults, ChannelOption } from "./types";

/**
 * Declared here rather than in actions.ts because a "use server" file may only
 * export async functions, and the Client Component imports this value at
 * runtime.
 */
const INITIAL_STATE: AlertFormState = {};

/**
 * Stream alert settings form.
 *
 * The test button posts a real message, so its outcome is shown separately
 * from the save outcome.
 */
export function AlertForm({
  streamingAccountId,
  channels,
  roles,
  defaults,
}: {
  streamingAccountId: string;
  channels: ChannelOption[];
  roles: ChannelOption[];
  defaults: AlertDefaults;
}) {
  const [state, formAction, pending] = useActionState<
    AlertFormState,
    FormData
  >(saveAlertSettingsAction, INITIAL_STATE);

  const [testState, testAction, testPending] = useActionState<
    AlertFormState,
    FormData
  >(async () => sendTestAlertAction(streamingAccountId), INITIAL_STATE);

  const [customMode, setCustomMode] = useState(
    defaults.messageMode === "CUSTOM",
  );
  const [watchEnabled, setWatchEnabled] = useState(
    defaults.watchButtonEnabled,
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="streamingAccountId" value={streamingAccountId} />

      <Panel
        title="Dispatch routing"
        description="Where this creator's live signal is announced."
        icon={Hash}
      >
        <div className="flex flex-col gap-3">
          <ToggleRow
            name="enabled"
            label="Send alerts for this channel"
            hint="Turn this off to keep the route configured but silent."
            defaultChecked={defaults.enabled}
          />

          <div className="grid gap-3 sm:grid-cols-2">
            <FormField
              label="Discord channel"
              hint="The alert is posted here by the Komu app."
            >
              <select
                name="channelId"
                defaultValue={defaults.channelId}
                className="komu-input"
              >
                <option value="">Not set</option>
                {channels.map((channel) => (
                  <option key={channel.id} value={channel.id}>
                    {channel.label}
                  </option>
                ))}
              </select>
            </FormField>

            <div className="flex flex-col gap-2">
              <FormField
                label="Mention role"
                hint="Optional. @everyone cannot be mentioned."
              >
                <select
                  name="mentionRoleId"
                  defaultValue={defaults.mentionRoleId}
                  className="komu-input"
                >
                  <option value="">No role</option>
                  {roles.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.label}
                    </option>
                  ))}
                </select>
              </FormField>
              <label className="flex items-center justify-between gap-3 text-[11px] text-[color:var(--color-komu-muted)]">
                <span className="inline-flex items-center gap-1.5">
                  <AtSign className="h-3 w-3" />
                  Mention the role on the alert
                </span>
                <input
                  type="checkbox"
                  name="mentionEnabled"
                  defaultChecked={defaults.mentionEnabled}
                  className="komu-switch"
                />
              </label>
            </div>
          </div>
        </div>
      </Panel>

      <Panel
        title="Message presentation"
        description="The copy and embed that members see in Discord."
        icon={MessageSquare}
      >
        <div className="flex flex-col gap-3">
          <FormField label="Message style">
            <select
              name="messageMode"
              value={customMode ? "CUSTOM" : "DEFAULT"}
              onChange={(event) => setCustomMode(event.target.value === "CUSTOM")}
              className="komu-input"
            >
              <option value="DEFAULT">Use the stream title</option>
              <option value="CUSTOM">Use my own message</option>
            </select>
          </FormField>

          {customMode ? (
            <FormField
              label="Custom message"
              hint="Placeholders: {creator} {title} {game} {viewers} {url}"
            >
              <textarea
                name="customMessage"
                rows={3}
                defaultValue={defaults.customMessage}
                placeholder="{creator} just went live! Playing {game}. {url}"
                className="komu-input"
              />
            </FormField>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
            <ToggleRow
              name="embedEnabled"
              label="Show an embed"
              hint="The richer card with stream details."
              defaultChecked={defaults.embedEnabled}
              className="min-h-[68px]"
            />
            <FormField label="Embed colour" hint="Six-digit hex value.">
              <div className="flex items-center gap-2">
                <span
                  className="h-9 w-9 shrink-0 rounded-lg border border-white/10"
                  style={{ backgroundColor: defaults.embedColor }}
                  aria-hidden
                />
                <input
                  name="embedColor"
                  defaultValue={defaults.embedColor}
                  placeholder="#6366f1"
                  className="komu-input"
                />
              </div>
            </FormField>
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            <ToggleRow
              name="showThumbnail"
              label="Show thumbnail"
              defaultChecked={defaults.showThumbnail}
            />
            <ToggleRow
              name="showGame"
              label="Show category"
              defaultChecked={defaults.showGame}
            />
            <ToggleRow
              name="showViewerCount"
              label="Show viewers"
              defaultChecked={defaults.showViewerCount}
            />
          </div>
        </div>
      </Panel>

      <Panel
        title="Interactive action"
        description="Give members one tap from the alert to the stream."
        icon={MousePointerClick}
      >
        <div className="flex flex-col gap-3">
          <ToggleRow
            name="watchButtonEnabled"
            label="Add a Watch Now button"
            hint="Renders a Discord link button under the alert."
            defaultChecked={defaults.watchButtonEnabled}
            onChange={(event) => setWatchEnabled(event.target.checked)}
          />

          {watchEnabled ? (
            <FormField label="Button label" hint="Discord limit: 80 characters.">
              <input
                name="watchButtonLabel"
                defaultValue={defaults.watchButtonLabel}
                className="komu-input max-w-sm"
              />
            </FormField>
          ) : null}
        </div>
      </Panel>

      <div className="flex flex-wrap items-center gap-2 border-t border-[color:var(--color-komu-border)] pt-4">
        <button
          type="submit"
          disabled={pending}
          className="komu-btn komu-btn-primary"
        >
          <Save className="h-4 w-4" />
          {pending ? "Saving…" : "Save settings"}
        </button>

        <button
          type="button"
          // The dispatch from useActionState has to run in a transition.
          // Called straight from onClick it still works, but React warns and
          // isPending does not update, so the button never says "Sending...".
          onClick={() =>
            startTransition(() => {
              void testAction(new FormData());
            })
          }
          disabled={testPending}
          className="komu-btn komu-btn-secondary"
        >
          <Send className="h-4 w-4" />
          {testPending ? "Sending…" : "Send test alert"}
        </button>

        <span className="ml-auto hidden items-center gap-1.5 text-[10px] text-[color:var(--color-komu-dim)] sm:inline-flex">
          <Radio className="h-3 w-3" />
          Test posts to the selected channel immediately.
        </span>
      </div>

      {state?.error ? <StatusMessage tone="error">{state.error}</StatusMessage> : null}
      {state?.ok ? (
        <StatusMessage tone="success">Settings saved.</StatusMessage>
      ) : null}
      {testState?.error ? (
        <StatusMessage tone="error">{testState.error}</StatusMessage>
      ) : null}
      {testState?.ok ? (
        <StatusMessage tone="success">
          Test alert sent. Check your Discord channel.
        </StatusMessage>
      ) : null}
    </form>
  );
}

function ToggleRow({
  name,
  label,
  hint,
  defaultChecked,
  onChange,
  className,
}: {
  name: string;
  label: string;
  hint?: string;
  defaultChecked?: boolean;
  onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
  className?: string;
}) {
  return (
    <label
      className={cn(
        "flex items-center justify-between gap-3 rounded-xl border border-[color:var(--color-komu-border)] bg-white/[0.015] px-3 py-2.5",
        className,
      )}
    >
      <span className="min-w-0">
        <span className="block text-xs font-medium text-[color:var(--color-komu-text)]">
          {label}
        </span>
        {hint ? (
          <span className="mt-0.5 block text-[10px] leading-4 text-[color:var(--color-komu-dim)]">
            {hint}
          </span>
        ) : null}
      </span>
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        onChange={onChange}
        className="komu-switch"
      />
    </label>
  );
}

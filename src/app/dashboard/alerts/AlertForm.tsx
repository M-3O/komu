"use client";

import { useActionState, useState } from "react";

import {
  INITIAL_STATE,
  saveAlertSettingsAction,
  sendTestAlertAction,
  type AlertFormState,
} from "./actions";

interface ChannelOption {
  id: string;
  label: string;
}

interface AlertDefaults {
  enabled: boolean;
  channelId: string;
  mentionRoleId: string;
  mentionEnabled: boolean;
  messageMode: string;
  customMessage: string;
  embedEnabled: boolean;
  embedColor: string;
  showThumbnail: boolean;
  showViewerCount: boolean;
  showGame: boolean;
  watchButtonEnabled: boolean;
  watchButtonLabel: string;
}

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

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <input type="hidden" name="streamingAccountId" value={streamingAccountId} />

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">Where alerts go</h2>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="enabled"
            defaultChecked={defaults.enabled}
            className="accent-[color:var(--color-komu-accent)]"
          />
          <span>Send alerts for this channel</span>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs tracking-wider text-[color:var(--color-komu-muted)] uppercase">
            Discord channel
          </span>
          <select
            name="channelId"
            defaultValue={defaults.channelId}
            className="rounded-md border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] px-3 py-2"
          >
            <option value="">Not set</option>
            {channels.map((channel) => (
              <option key={channel.id} value={channel.id}>
                {channel.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="mentionEnabled"
            defaultChecked={defaults.mentionEnabled}
            className="accent-[color:var(--color-komu-accent)]"
          />
          <span>Mention a role when posting</span>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs tracking-wider text-[color:var(--color-komu-muted)] uppercase">
            Mention role
          </span>
          <select
            name="mentionRoleId"
            defaultValue={defaults.mentionRoleId}
            className="rounded-md border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] px-3 py-2"
          >
            <option value="">None</option>
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.label}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">Message</h2>

        <label className="flex flex-col gap-1">
          <span className="text-xs tracking-wider text-[color:var(--color-komu-muted)] uppercase">
            Style
          </span>
          <select
            name="messageMode"
            value={customMode ? "CUSTOM" : "DEFAULT"}
            onChange={(event) => setCustomMode(event.target.value === "CUSTOM")}
            className="rounded-md border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] px-3 py-2"
          >
            <option value="DEFAULT">Use the stream title</option>
            <option value="CUSTOM">Use my own message</option>
          </select>
        </label>

        {customMode ? (
          <label className="flex flex-col gap-1">
            <span className="text-xs tracking-wider text-[color:var(--color-komu-muted)] uppercase">
              Custom message
            </span>
            <textarea
              name="customMessage"
              rows={3}
              defaultValue={defaults.customMessage}
              placeholder="{creator} just went live! Playing {game}. {url}"
              className="rounded-md border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] px-3 py-2"
            />
            <span className="text-xs text-[color:var(--color-komu-muted)]">
              Placeholders: {"{creator} {title} {game} {viewers} {url}"}
            </span>
          </label>
        ) : null}

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="embedEnabled"
            defaultChecked={defaults.embedEnabled}
            className="accent-[color:var(--color-komu-accent)]"
          />
          <span>Show an embed</span>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs tracking-wider text-[color:var(--color-komu-muted)] uppercase">
            Embed colour
          </span>
          <input
            name="embedColor"
            defaultValue={defaults.embedColor}
            placeholder="#7c5cff"
            className="w-32 rounded-md border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] px-3 py-2"
          />
        </label>

        <div className="flex flex-col gap-2">
          <CheckboxField name="showThumbnail" label="Show thumbnail" defaultChecked={defaults.showThumbnail} />
          <CheckboxField name="showGame" label="Show category" defaultChecked={defaults.showGame} />
          <CheckboxField name="showViewerCount" label="Show viewer count" defaultChecked={defaults.showViewerCount} />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">Watch button</h2>

        <CheckboxField
          name="watchButtonEnabled"
          label="Add a Watch Now button"
          defaultChecked={defaults.watchButtonEnabled}
        />

        {defaults.watchButtonEnabled ? (
          <label className="flex flex-col gap-1">
            <span className="text-xs tracking-wider text-[color:var(--color-komu-muted)] uppercase">
              Button label
            </span>
            <input
              name="watchButtonLabel"
              defaultValue={defaults.watchButtonLabel}
              className="w-56 rounded-md border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] px-3 py-2"
            />
          </label>
        ) : null}
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-[color:var(--color-komu-accent)] px-5 py-2.5 font-medium text-white transition hover:bg-[color:var(--color-komu-accent-hover)] disabled:opacity-60"
        >
          {pending ? "Saving..." : "Save settings"}
        </button>

        <button
          type="button"
          onClick={() => testAction(new FormData())}
          disabled={testPending}
          className="rounded-lg border border-[color:var(--color-komu-border)] px-5 py-2.5 font-medium transition hover:bg-[color:var(--color-komu-surface)] disabled:opacity-60"
        >
          {testPending ? "Sending..." : "Send test alert"}
        </button>
      </div>

      {state?.error ? <StatusLine message={state.error} /> : null}
      {state?.ok ? <StatusLine message="Settings saved." tone="ok" /> : null}
      {testState?.error ? <StatusLine message={testState.error} /> : null}
      {testState?.ok ? (
        <StatusLine message="Test alert sent. Check your Discord channel." tone="ok" />
      ) : null}
    </form>
  );
}

function CheckboxField({
  name,
  label,
  defaultChecked,
}: {
  name: string;
  label: string;
  defaultChecked: boolean;
}) {
  return (
    <label className="flex items-center gap-2">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="accent-[color:var(--color-komu-accent)]"
      />
      <span>{label}</span>
    </label>
  );
}

function StatusLine({
  message,
  tone = "error",
}: {
  message: string;
  tone?: "error" | "ok";
}) {
  return (
    <p
      role="status"
      className={
        tone === "ok"
          ? "rounded-md border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] p-3 text-sm"
          : "rounded-md border border-[color:var(--color-komu-live)] bg-[color:var(--color-komu-live)]/10 p-3 text-sm text-[color:var(--color-komu-live)]"
      }
    >
      {message}
    </p>
  );
}
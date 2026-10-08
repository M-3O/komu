"use client";

import { useActionState } from "react";

import { connectChannelAction, disconnectChannelAction } from "./actions";

interface ConnectedChannel {
  id: string;
  provider: string;
  username: string;
  displayName: string | null;
}

/**
 * Connect a streaming channel, and disconnect one that is no longer wanted.
 *
 * A Client Component because submitting the form needs `useActionState` to
 * show the provider's response.
 */
export function ChannelManager({
  channels,
  availableProviders,
}: {
  channels: ConnectedChannel[];
  availableProviders: string[];
}) {
  const [state, formAction, pending] = useActionState(
    async (
      _previous: { error: string } | null,
      formData: FormData,
    ) => {
      const provider = String(formData.get("provider") ?? "");
      const identifier = String(formData.get("identifier") ?? "").trim();

      const result = await connectChannelAction(provider, identifier);

      return result.ok ? null : { error: result.error ?? "Could not connect." };
    },
    null,
  );

  const [disconnectState, disconnectAction, disconnectPending] =
    useActionState(
      async (
        _previous: { error: string } | null,
        formData: FormData,
      ) => {
        const id = String(formData.get("streamingAccountId") ?? "");
        const result = await disconnectChannelAction(id);

        return result.ok ? null : { error: result.error ?? "Could not disconnect." };
      },
      null,
    );

  return (
    <div className="flex flex-col gap-6">
      {channels.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {channels.map((channel) => (
            <li
              key={channel.id}
              className="flex items-center justify-between gap-4 rounded-lg border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] p-4"
            >
              <span>
                <span className="font-medium">
                  {channel.displayName ?? channel.username}
                </span>
                <span className="ml-2 text-sm text-[color:var(--color-komu-muted)]">
                  {channel.provider} · {channel.username}
                </span>
              </span>

              <form action={disconnectAction}>
                <input
                  type="hidden"
                  name="streamingAccountId"
                  value={channel.id}
                />
                <button
                  type="submit"
                  disabled={disconnectPending}
                  className="rounded-md border border-[color:var(--color-komu-border)] px-3 py-1.5 text-sm text-[color:var(--color-komu-muted)] transition hover:border-[color:var(--color-komu-live)] hover:text-[color:var(--color-komu-live)] disabled:opacity-60"
                >
                  {disconnectPending ? "Removing..." : "Disconnect"}
                </button>
              </form>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-lg border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] p-4 text-sm text-[color:var(--color-komu-muted)]">
          No channels connected yet.
        </p>
      )}

      <form action={formAction} className="flex flex-col gap-3">
        <h2 className="font-semibold">Connect a channel</h2>

        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs tracking-wider text-[color:var(--color-komu-muted)] uppercase">
              Platform
            </span>
            <select
              name="provider"
              defaultValue={availableProviders[0] ?? ""}
              className="rounded-md border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] px-3 py-2"
            >
              {availableProviders.map((provider) => (
                <option key={provider} value={provider}>
                  {provider}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs tracking-wider text-[color:var(--color-komu-muted)] uppercase">
              Channel
            </span>
            <input
              name="identifier"
              required
              placeholder="twitch login or channel id"
              className="rounded-md border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] px-3 py-2"
            />
          </label>

          <button
            type="submit"
            disabled={pending || availableProviders.length === 0}
            className="rounded-lg bg-[color:var(--color-komu-accent)] px-5 py-2 font-medium text-white transition hover:bg-[color:var(--color-komu-accent-hover)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? "Connecting..." : "Connect"}
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

        {disconnectState?.error ? (
          <p
            role="alert"
            className="rounded-md border border-[color:var(--color-komu-live)] bg-[color:var(--color-komu-live)]/10 p-3 text-sm text-[color:var(--color-komu-live)]"
          >
            {disconnectState.error}
          </p>
        ) : null}
      </form>
    </div>
  );
}
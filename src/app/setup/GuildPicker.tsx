"use client";

import { useActionState } from "react";

import { connectGuildAction } from "./actions";

interface GuildOption {
  id: string;
  name: string;
  icon: string | null;
}

/**
 * Server picker.
 *
 * A Client Component because `useActionState` handles the form submission and
 * shows the result of the server-side permission check.
 */
export function GuildPicker({ guilds }: { guilds: GuildOption[] }) {
  const [state, formAction, pending] = useActionState(
    async (_previous: { error: string } | null, formData: FormData) => {
      const guildDiscordId = String(formData.get("guildDiscordId") ?? "");
      return connectGuildAction(guildDiscordId);
    },
    null,
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {guilds.length === 0 ? (
        <p className="rounded-md border border-[color:var(--color-komu-border)] p-4 text-sm text-[color:var(--color-komu-muted)]">
          No servers found where you are the owner or an administrator. Create
          a Discord server and give yourself the Administrator role, then
          reload this page.
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            {guilds.map((guild) => (
              <label
                key={guild.id}
                className="flex cursor-pointer items-center gap-3 rounded-lg border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] p-3 transition has-checked:border-[color:var(--color-komu-accent)]"
              >
                <input
                  type="radio"
                  name="guildDiscordId"
                  value={guild.id}
                  required
                  className="accent-[color:var(--color-komu-accent)]"
                />
                <GuildBadge guild={guild} />
              </label>
            ))}
          </div>

          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-[color:var(--color-komu-accent)] px-5 py-2.5 font-medium text-white transition hover:bg-[color:var(--color-komu-accent-hover)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? "Connecting..." : "Connect this server"}
          </button>
        </>
      )}

      {state?.error ? (
        <p
          role="alert"
          className="rounded-md border border-[color:var(--color-komu-live)] bg-[color:var(--color-komu-live)]/10 p-3 text-sm text-[color:var(--color-komu-live)]"
        >
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

function GuildBadge({ guild }: { guild: GuildOption }) {
  const iconUrl = guild.icon
    ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=64`
    : null;

  return (
    <span className="flex items-center gap-3">
      {iconUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={iconUrl} alt="" width={32} height={32} className="rounded" />
      ) : (
        <span
          aria-hidden
          className="grid h-8 w-8 place-items-center rounded bg-[color:var(--color-komu-surface-raised)] text-sm font-semibold"
        >
          {guild.name.slice(0, 2).toUpperCase()}
        </span>
      )}
      <span className="font-medium">{guild.name}</span>
    </span>
  );
}
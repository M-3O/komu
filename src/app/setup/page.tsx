import Image from "next/image";
import { Suspense } from "react";

import { requireCurrentUser, getManageableGuilds } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db";
import { GuildPicker } from "./GuildPicker";

export const metadata = { title: "Set up your server" };

/**
 * Server selection.
 *
 * Reached after sign-in when no server is connected yet, or when the person
 * who signed in cannot administer the connected server.
 *
 * The authorisation check lives inside the `<Suspense>` boundary because it
 * reads the session cookie. `proxy.ts` sends signed-out visitors to the login
 * page before render; the check here is the actual guard.
 */
export default function SetupPage() {
  return (
    <main className="flex min-h-screen justify-center px-6 py-16">
      <div className="w-full max-w-lg">
        <div className="mb-8 flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-tr from-indigo-500 via-violet-500 to-fuchsia-500 p-px shadow-[0_0_24px_-6px_rgba(99,102,241,.8)]">
            <span className="flex h-full w-full overflow-hidden rounded-full bg-[#050505]">
              <Image
                src="/brand/komu-logo.webp"
                alt=""
                width={64}
                height={64}
                className="h-full w-full object-cover"
              />
            </span>
          </span>
          <span className="font-display text-lg font-bold tracking-[-0.03em]">
            Komu
          </span>
        </div>

        <h1 className="text-2xl font-bold tracking-tight">Connect your server</h1>
        <p className="mt-2 text-sm text-[color:var(--color-komu-muted)]">
          Choose the Discord server Komu should manage. You need to be the
          owner or an administrator.
        </p>

        <div className="mt-8">
          <Suspense fallback={<PickerSkeleton />}>
            <GuildSelection />
          </Suspense>
        </div>
      </div>
    </main>
  );
}

async function GuildSelection() {
  const user = await requireCurrentUser("/setup");

  const connected = await prisma.guild.findFirst({
    orderBy: { createdAt: "asc" },
    select: { discordId: true, name: true },
  });

  let guilds: Awaited<ReturnType<typeof getManageableGuilds>> = [];

  try {
    guilds = await getManageableGuilds(user.userId);
  } catch {
    // Discord could not be reached. Show a retry hint rather than crashing.
    return (
      <div className="flex flex-col gap-4">
        <p className="rounded-md border border-[color:var(--color-komu-live)] bg-[color:var(--color-komu-live)]/10 p-4 text-sm text-[color:var(--color-komu-live)]">
          We could not reach Discord to list your servers. Check your
          connection and reload this page.
        </p>
        <a
          href="/api/auth/login"
          className="self-start rounded-lg border border-[color:var(--color-komu-border)] px-4 py-2 text-sm hover:bg-[color:var(--color-komu-surface)]"
        >
          Sign in again
        </a>
      </div>
    );
  }

  // A server is already connected and this person cannot administer it. The
  // action would refuse to repoint the installation, so offering the picker
  // would only produce an error after they had chosen.
  const canManageConnected =
    !connected ||
    guilds.some((guild) => guild.id === connected.discordId);

  return (
    <div className="flex flex-col gap-4">
      {connected ? (
        <div className="rounded-lg border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] p-4">
          <p className="text-sm text-[color:var(--color-komu-muted)]">
            Currently connected
          </p>
          <p className="font-medium">{connected.name}</p>
          {!canManageConnected ? (
            <p className="mt-3 text-sm text-[color:var(--color-komu-live)]">
              You are not an owner or administrator of that server, so Komu
              cannot manage it. An installation cannot be pointed at a
              different server by someone who does not administer this one.
              Ask an owner or administrator of {connected.name} to sign in.
            </p>
          ) : null}
        </div>
      ) : null}

      {canManageConnected ? <GuildPicker guilds={guilds} /> : null}
    </div>
  );
}

function PickerSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-hidden>
      {[0, 1].map((index) => (
        <div
          key={index}
          className="h-16 animate-pulse rounded-lg border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)]"
        />
      ))}
    </div>
  );
}
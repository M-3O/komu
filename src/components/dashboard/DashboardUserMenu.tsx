/**
 * Username and sign-out, shown in the dashboard header.
 *
 * Sign-out is a POST form pointing at the logout route, so another site
 * cannot force a visitor to log out by sending them to a URL.
 */
export function DashboardUserMenu({
  username,
  avatarUrl,
}: {
  username: string;
  avatarUrl: string | null;
}) {
  return (
    <div className="flex items-center gap-3">
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={avatarUrl}
          alt=""
          width={28}
          height={28}
          className="rounded-full"
        />
      ) : null}

      <span className="text-sm font-medium">{username}</span>

      <form action="/logout" method="post">
        <button
          type="submit"
          className="rounded-md border border-[color:var(--color-komu-border)] px-3 py-1.5 text-sm text-[color:var(--color-komu-muted)] transition hover:bg-[color:var(--color-komu-surface)] hover:text-[color:var(--color-komu-text)]"
        >
          Sign out
        </button>
      </form>
    </div>
  );
}
export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="flex flex-col items-center gap-3">
        <h1 className="text-4xl font-bold tracking-tight">Komu</h1>
        <p className="max-w-md text-[color:var(--color-komu-muted)]">
          Connect your streaming channels to Discord and turn your community
          into an active one.
        </p>
      </div>
      <a
        href="/dashboard"
        className="rounded-lg bg-[color:var(--color-komu-accent)] px-5 py-2.5 font-medium text-white transition hover:bg-[color:var(--color-komu-accent-hover)]"
      >
        Open dashboard
      </a>
    </main>
  );
}
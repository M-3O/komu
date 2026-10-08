# Komu

A Discord bot and web dashboard for streamers, YouTubers and Discord community
owners. Connect Twitch, YouTube or Kick to a Discord server and Komu posts live
alerts, awards XP, assigns roles, and keeps members engaged.

Built as a Next.js monolith with PostgreSQL, Prisma and Discord.js.

## Requirements

- Node.js 20 or newer
- A PostgreSQL database (local install, Neon, Supabase, etc.)
- A Discord application with a bot user

## Getting started

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create your environment file:

   ```bash
   cp .env.example .env.local
   ```

   Fill in `DATABASE_URL` and the Discord credentials. See `.env.example` for
   what each value is used for.

3. Create the database tables:

   ```bash
   npm run db:migrate
   ```

4. Load test data (optional, gives the dashboard something to show):

   ```bash
   npm run db:seed
   ```

5. Start the app:

   ```bash
   npm run dev
   ```

The dashboard is at <http://localhost:3000/dashboard>.

## Scripts

| Script                | Purpose                                     |
| --------------------- | ------------------------------------------- |
| `npm run dev`         | Start the dev server                        |
| `npm run build`       | Production build                            |
| `npm run start`       | Run the production build                    |
| `npm run lint`        | ESLint                                      |
| `npm run typecheck`   | Generate route types, then typecheck         |
| `npm test`            | Unit tests                                  |
| `npm run db:migrate`  | Create and apply a migration in development |
| `npm run db:deploy`   | Apply migrations in production              |
| `npm run db:seed`     | Load test data                              |
| `npm run db:studio`   | Browse the database                         |
| `npm run db:reset`    | Drop, re-migrate and re-seed                |

## Project layout

```text
src/
├── app/            Next.js routes
│   ├── (auth)/     Login, OAuth callback, sign out
│   ├── api/auth/   OAuth start endpoint
│   ├── dashboard/  Protected dashboard pages
│   └── setup/      Discord server selection
├── components/     React components
├── lib/            Business logic and integrations
│   ├── auth/       Sessions, Discord OAuth, permission checks
│   ├── config/     Environment validation
│   ├── dashboard/  Dashboard queries and navigation
│   ├── db.ts       Shared Prisma client
│   ├── guilds/     Discord server access
│   ├── levels/     Level maths
│   └── logger.ts   Logging
├── proxy.ts        Sends signed-out visitors to the login page
└── bot/            Discord.js client (coming in Phase 3)
prisma/
├── schema.prisma   Data model
├── seed.ts         Test data
└── migrations/     Migration history
```

Each product area gets its own folder under `src/lib` (`streams`, `xp`,
`rewards`, `challenges`, `moderation`, and so on). Business logic stays out of
React components: pages call a service, services talk to the database and
integrations.

## Architecture

A single Next.js app handles the dashboard, the server-side logic and the API.
The Discord bot runs in the same repository. There are no microservices, queues,
workers or caches in V1.

Streaming providers are isolated behind a shared interface so the rest of the
application never sees a provider-specific response shape.

## Signing in

Komu uses Discord OAuth. Set up an application at
<https://discord.com/developers/applications>:

1. Copy `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET` from **General
   Information**, and `DISCORD_BOT_TOKEN` from **Bot** (tap *Reset Token*
   first).
2. Under **OAuth2 > Redirects**, add:
   `http://localhost:3000/callback`
   For a hosted deployment, add that deployment's `/callback` URL too.
3. Set `NEXT_PUBLIC_APP_URL` to the site origin, with no trailing slash.

The scopes Komu requests are `identify` and `guilds`. No bot permissions are
needed to sign in; they are needed for Phase 3 onwards.

Signing in walks through:

```text
Login with Discord
        ↓
Pick a server you own or administer
        ↓
Dashboard, scoped to that server
```

V1 manages one server. Signing in without admin rights on the connected
server sends you to `/setup` with an explanation rather than a dashboard.

## Development status

Phases 0 to 2 are done: project setup, database schema, and Discord sign-in.

| Phase | Scope                                       | Status |
| ----- | ------------------------------------------- | ------ |
| 0     | Project setup                               | Done   |
| 1     | Database foundation                         | Done   |
| 2     | Discord OAuth                               | Done   |
| 3     | Discord bot foundation                      | Next   |
| 4     | Streaming account integrations (Twitch 1st) | Todo   |
| 5     | Stream alerts                               | Todo   |
| 6+    | XP, levels, roles, leaderboards, rewards, challenges, achievements, moderation, analytics | Todo |

See `PRD.md` and `IMPLEMENTATION_PLAN.md` for the full requirements.

## Security notes

- Secrets live in `.env.local`, which is gitignored. `.env.example` holds
  placeholders only.
- Bot tokens, OAuth secrets and provider tokens are only read in server code.
  Nothing secret is sent to the browser.
- The session is an HMAC-signed cookie (`AUTH_SECRET`), httpOnly and
  sameSite=lax, valid for seven days.
- The OAuth `state` value is compared in constant time, so another site
  cannot feed the callback a forged authorization code.
- Signing out is POST-only, so a third-party page cannot force a sign-out.
- `proxy.ts` redirects signed-out visitors to the login page, but it is only
  a convenience. Each data function and server action re-checks the session,
  because a matcher change must never silently expose data.
- The server id chosen on the setup screen is treated as untrusted input: it is
  re-checked against the user's live guild list, and the server name and icon
  come from Discord's response rather than the form.
- Every dashboard mutation must be permission-checked server-side.

## Bot permissions

Komu needs these Discord permissions in the server it manages:

- View Channels
- Send Messages
- Embed Links
- Read Message History
- Manage Roles (to award level and reward roles)
- Moderate Members (to time out and kick)
- Ban Members
- Manage Messages (to delete filtered or spam messages)

Grant the role Komu uses to manage other roles below the highest role it needs,
so it cannot escalate privileges.
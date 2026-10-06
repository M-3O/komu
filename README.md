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
├── app/            Next.js routes (dashboard pages, API handlers)
│   └── dashboard/
├── components/     React components
├── lib/            Business logic and integrations
│   ├── config/     Environment validation
│   ├── dashboard/  Dashboard queries and navigation
│   ├── db.ts       Shared Prisma client
│   ├── guilds/     Discord server access
│   ├── levels/     Level maths
│   └── logger.ts   Logging
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

## Development status

Phases 0 and 1 are done: project setup, database schema, and test data.

| Phase | Scope                                       | Status |
| ----- | ------------------------------------------- | ------ |
| 0     | Project setup                               | Done   |
| 1     | Database foundation                         | Done   |
| 2     | Discord OAuth                               | Next   |
| 3     | Discord bot foundation                      | Todo   |
| 4     | Streaming account integrations (Twitch 1st) | Todo   |
| 5     | Stream alerts                               | Todo   |
| 6+    | XP, levels, roles, leaderboards, rewards, challenges, achievements, moderation, analytics | Todo |

See `PRD.md` and `IMPLEMENTATION_PLAN.md` for the full requirements.

## Security notes

- Secrets live in `.env.local`, which is gitignored. `.env.example` holds
  placeholders only.
- Bot tokens, OAuth secrets and provider tokens are only read in server code.
  Nothing secret is sent to the browser.
- Every dashboard mutation must be permission-checked server-side. IDs from the
  client are never trusted without validation.

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
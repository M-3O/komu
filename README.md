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
| `npm run check:bot`   | Verify the bot's imports load cleanly        |
| `npm run verify`      | Everything above, plus a production build    |
| `npm run db:migrate`  | Create and apply a migration in development |
| `npm run db:deploy`   | Apply migrations in production              |
| `npm run db:seed`     | Load test data                              |
| `npm run db:studio`   | Browse the database                         |
| `npm run db:reset`    | Drop, re-migrate and re-seed                |

## Streaming integrations

Provider APIs are isolated behind one interface, so nothing outside
`src/lib/twitch` (and later `src/lib/youtube` and `src/lib/kick`) needs to
know a Twitch response shape. Callers get a `StreamInfo`:

```text
StreamInfo
├── provider, creatorId, creatorUsername, providerStreamId
├── title, game, thumbnail, viewerCount
└── url, startedAt
```

Reaching a provider goes through `lib/streams`:

```ts
import { getLiveStatuses } from "@/lib/streams";

const channels = await getLiveStatuses(guildId);
```

`getLiveStatuses` checks every connected channel and reports failures per
channel, so one provider being unreachable does not hide the others. A
channel with `error` set has an unknown status, which is deliberately
distinct from a channel that is simply offline.

Live status is fetched on `/dashboard/streams` rather than the overview,
because every check is an external API call and the overview should stay
cheap.

### Twitch setup

Create an application at <https://dev.twitch.tv/console/apps> and set
`TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET`.

Komu uses an **app access token**, not a user token. Reading whether a
channel is live needs no user authorisation, so the creator never has to
grant Komu access to their account and no refresh-token handling is needed.

Channels are connected by typing a Twitch login or channel id on
`/dashboard/streams`. The identifier is resolved through Twitch before
anything is stored, so Komu saves Twitch's own ids and display name rather
than whatever was typed. YouTube and Kick are listed in the schema but not
yet implemented; asking for one returns "not supported yet".

## Stream alerts

Configure alerts on `/dashboard/alerts`. Channel and role lists come from
Discord, so you pick from real options rather than pasting ids. The
**Send test alert** button posts a real message so you can confirm the
channel and role before waiting for a stream.

### How detection works

V1 polls the streaming provider on a schedule. The plan explicitly allows
this, and the polling logic is isolated in `lib/streams/poller.ts` so it can
be replaced by webhooks or a real job system later without touching the
rest of the app.

One pass checks every connected channel, decides what changed, and acts.
The decision lives in `lib/streams/decide-alert.ts` as a pure function,
because "alert exactly once per live session" is the rule worth testing
properly.

Alerts are sent over the Discord REST API, not the bot's gateway
connection, so detection works whether or not `npm run bot` is running.

### Triggering a pass

Pick one. Setting both means overlapping passes.

**External cron** (recommended for hosted deployments):

```bash
curl -H "x-poll-secret: $STREAM_POLL_SECRET" \
  https://your-app.example/api/internal/poll-streams
```

**In-process timer** (self-hosted). Set `STREAM_POLL_INTERVAL_SECS=60` and
restart. Leave it empty otherwise, so the app never polls on its own.

The endpoint refuses to run when `STREAM_POLL_SECRET` is unset, and compares
the secret in constant time. Without that, anyone who found the URL could
use your bot to send messages.

A plain timer is not reliable on platforms that freeze idle instances. That
is why the endpoint exists as an alternative, and why the interval is opt-in.

### Behaviour worth knowing

- **Alerts are deduplicated** on the provider's stream id, so one live
  session never produces two alerts no matter how often the poll runs.
- **A provider outage does not look like an ended stream.** If Twitch cannot
  be reached, the channel is skipped and any open session is left alone.
- **A failed alert is retried.** The session is marked as announced only
  after Discord accepts the message.
- **Offline is tracked.** Sessions get an end time, which is what lets a
  later stream be recognised as new.

## XP and levels

Members earn XP for qualifying Discord messages. `/level` and `/profile`
show progress.

Every change goes through `lib/xp/award-xp.ts`, which writes three things
together: a transaction row (the real history — never just a running total),
the member's cached total and level, and a level-change result for the caller
to announce.

### Level curve

`lib/levels/calculate-level.ts` uses a quadratic curve:
`xpForLevel(N) = 100 * N * (N + 1) / 2`. Level 2 at 100 XP, level 10 at
2,750, level 25 at 16,250. Raising `XP_CURVE_BASE` slows every level.

### Abuse prevention

Configured per server on the `guilds` table for now:

| Setting                | Default | Purpose                              |
| ---------------------- | ------- | ------------------------------------ |
| `xpMessageAmount`      | 15      | XP per qualifying message            |
| `xpMessageMinLength`   | 3       | Filters "lol" style spam             |
| `xpMessageCooldownSecs`| 60      | Minimum gap between XP messages      |
| `xpDailyCap`           | 1000    | Ceiling per member per day           |

Repeated identical messages stop earning XP after two repeats. Detection uses
a short hash of the last message, so Discord content is never stored.

The daily cap resets lazily: `xpToday` is reset when it is read and found to
be from an earlier day. That avoids a scheduled job, which V1 rules out.

### Two copies of the same number

`GuildMember.xp/level` and `MemberXP.totalXp/level` hold the same values.
`GuildMember` is the fast-read copy that leaderboard queries use
(PRD section 14); `MemberXP` carries level detail like `xpToNextLevel`.
They are written in one transaction so they cannot drift.

Note: modules shared between the Next.js app and the standalone bot process
must not use `import "server-only"`. It throws outside a Next.js server
bundle, which would stop the bot from starting.

## Automatic roles

Rules of the form "when a member reaches X, give them @Role" are configured
on `/dashboard/roles`. Roles come from Discord, so you pick from real
options.

Thresholds are evaluated in `lib/roles/evaluate-rules.ts`, pure functions with
23 tests covering every metric and the no-repeat requirement.

**Idempotency** uses the member's *live* Discord role list, not a cached
database copy. That is what stops the bot re-adding a role after a restart.

**Available metrics**: Level reached, Total XP, Messages sent, Days in
server. Watch time and stream attendance are deliberately not offered — the
plan says to add a watch-time rule only when the required data exists, and
V1 collects neither. The dashboard lists them as unavailable rather than
offering a rule that could never fire.

### When rules are checked

On every qualifying message, and when someone joins. A member who joins and
then goes silent will not pick up a "30 days in server" role until they next
interact — V1 has no daily sweep, and adding one would mean scheduled work the
plan rules out.

### When a role cannot be assigned

A role above the bot's highest role fails every time. The bot logs
`Role assignment failed` with the rule name and a reason such as
`ROLE_HIERARCHY`, rather than failing silently on every message. Move the
bot's role above the role it needs to grant.

## Leaderboards

Available on `/dashboard/leaderboards` and via `/leaderboard`, for three
rolling periods and two metrics.

| Period   | Window      | XP reads from                | Activity reads from                    |
| -------- | ----------- | ---------------------------- | ------------------------------------- |
| Weekly   | Last 7 days | `XPTransaction` sum          | XP-earning messages in the window     |
| Monthly  | Last 30 days| `XPTransaction` sum          | XP-earning messages in the window     |
| All time | Everything  | `GuildMember.xp` (indexed)   | `GuildMember.messageCount` (indexed)  |

Two deliberate choices worth knowing:

**Rolling windows, not calendar weeks.** A calendar week starts empty every
Monday and a calendar month on the 1st, so both would show an empty board for
part of every period.

**Moderator grants do not rank.** `XPSource.MANUAL` is excluded, because a
moderator grant is administrative rather than earned, and including it would
put whoever received the last grant at the top of the board.

**Windowed activity counts only XP-earning messages.** The cooldown means most
messages never become a transaction, so this is lower than the true message
count. The dashboard says so rather than letting the number imply otherwise.
All-time activity uses the real total, which is why the two differ.

## Stream attendance

Discord exposes no watch telemetry, so attendance cannot be observed.
**A member reacting to the live alert is the signal V1 uses.**

```text
Creator goes live
   ↓
Alert posts to Discord (message id stored on the Stream row)
   ↓
A member reacts to that message
   ↓
Attendance recorded, 25 XP, roles and rewards re-checked
```

**What a reaction actually proves:** someone was in the channel when the
alert posted. It is engagement, not verified watch time. Watch time is
tracked separately in minutes and is never populated by this mechanism, which
is why the watch-time role metric and watch-time rewards stay unavailable.

**Deduplication** uses a unique constraint on (streamId, memberId) with
`skipDuplicates`, not a caught error. A busy server produces repeat reactions
constantly, and the try/catch version logged a `prisma:error` for each one.

Roles and rewards are re-checked after attendance, so a "3 streams attended"
role appears without waiting for the next message.

## Rewards

A reward is a **condition** over a metric, plus one **action**.

```text
Condition: Level reached 5
Action:    Give 500 XP
```

The decision is a pure function in `lib/rewards/evaluate.ts`, so the rules
handing out real XP and real roles are testable without Discord or a
database. Executing the actions is separate, in `lib/rewards/grant.ts`.

Roles and rewards are both "condition → effect" over the same numbers, so the
metric maths lives in one place, `lib/progression/metrics.ts`, and both import
it. A threshold therefore means the same thing whether it is on a role or a
reward.

### Conditions

`Level reached`, `Total XP reached`, `Messages sent`, `Streams attended`, and
`Days in server`.

Hours watched is deliberately absent: nothing collects watch time, so the
condition could never fire. The dashboard lists it under "Not available yet"
with the reason rather than offering a rule that silently does nothing.

### Actions

`Give XP`, `Give a role`, `Take away a role`, `Unlock an achievement`.

Giveaway entry is in the schema but not offered. There is no `Giveaway` entity
for an entry to be recorded against, so offering it would produce a reward
that looks configured and does nothing.

### Granting

A one-shot reward is granted once per member. The check is a query against
`RewardGrant` rather than a unique constraint, because repeatable rewards
legally have many grants for the same pair.

Rewards bypass the daily XP cap. The cap exists to stop grinding from
messages; a creator's reward is a deliberate grant.

**A failed action still records the grant.** If a role is above the bot's
highest role, the reward is not retried on every subsequent message. The
failure is reported so the creator can fix the role instead of watching
nothing happen.

### Granting by hand

`/reward @member Reward name` in Discord. It needs `Administrator`, read from
the caller's live Discord permissions rather than anything the client sent.

A moderator can re-grant a reward a member already has, but **cannot grant one
they have not earned**. Without that limit the command would be an XP printer
with extra steps.

## Verifying changes

```bash
npm run verify
```

Runs the bot import check, typecheck, lint, tests, and the production build.

`check:bot` exists because of a mistake worth repeating: a module reachable
from the bot that carried `import "server-only"` stopped the bot from
starting, while `tsc` and `next build` both passed. That happened twice, so
there is now an explicit check. **Any `lib` module a bot command imports must
not use `server-only`.**

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
│   ├── attendance/ Stream attendance from alert reactions
│   ├── auth/       Sessions, Discord OAuth, permission checks
│   ├── config/     Environment validation
│   ├── dashboard/  Dashboard queries and navigation
│   ├── db.ts       Shared Prisma client
│   ├── guilds/     Discord server access
│   ├── discord/    REST calls (channels, roles, posting)
│   ├── leaderboards/ Periods and ranking queries
│   ├── levels/     Level maths
│   ├── logger.ts   Logging
│   ├── progression/ Shared metric maths used by roles and rewards
│   ├── rewards/    Reward evaluation, granting and history
│   ├── roles/      Role rule evaluation and assignment
│   ├── streams/    Provider interface, live status, alert polling
│   ├── twitch/     Twitch Helix client and normaliser
│   └── xp/         XP awards, daily window, anti-abuse rules
├── instrumentation.ts  Starts the optional in-process poller
├── bot/            Discord bot (its own process)
│   ├── index.ts      Entry point
│   ├── config.ts     Intents and credentials
│   ├── commands/     Slash command definitions and handlers
│   ├── events/       Gateway event handlers
│   ├── permissions.ts  Live Discord permission checks
│   ├── services/     Progression, moderation and message helpers
│   └── register-commands.ts
└── proxy.ts        Sends signed-out visitors to the login page
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

## Running the bot

The Discord bot runs as its own process, separate from the web app:

```bash
npm run bot
```

This is not a background worker in the sense the plan rules out. There is no
queue and no job system; a gateway connection simply has to stay open for as
long as the bot is online.

Register the slash commands once:

```bash
npm run bot:register -- --guild   # one server, appears immediately
npm run bot:register              # globally, can take up to an hour
```

Use `--guild` while developing. Discord caches global commands aggressively, so
a global change may not show up for a while.

### Slash commands

| Command | What it does |
| ------- | ------------ |
| `/help` | Lists the commands. |
| `/ping` | Confirms the bot is responsive. |
| `/setup` | Reports configuration and missing permissions. |
| `/level` | Shows your own XP and level. |
| `/profile` | Shows your level, rank and streaks. |
| `/leaderboard` | Top members by XP or activity. |
| `/reward` | Grant a reward to a member by hand. Needs `Administrator`. |

### Privileged intents

Three intents must be enabled in the developer portal under
**Bot → Privileged Gateway Intents**, or the corresponding events never
arrive and the bot looks online but does nothing:

- **Server Members Intent** — join and leave events
- **Message Content Intent** — reads message text, needed for XP
- **Message Intent** — message events

### Permissions

`/setup` reports what is missing. It checks:

View Channel, Send Messages, Embed Links, Read Message History, Manage Roles,
Moderate Members, Ban Members, Manage Messages.

Place the bot's role below any role it must be able to assign, or every role
assignment fails with a hierarchy error.

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

Phases 0 to 9 are done, plus the stream-attendance mechanism that several
later features depend on.

| Phase | Scope                                       | Status |
| ----- | ------------------------------------------- | ------ |
| 0     | Project setup                               | Done   |
| 1     | Database foundation                         | Done   |
| 2     | Discord OAuth                               | Done   |
| 3     | Discord bot foundation                      | Done   |
| 4     | Streaming integrations (Twitch 1st)         | Done   |
| 4b    | Streaming integrations (YouTube, Kick)      | Todo   |
| 5     | Stream alerts                               | Done   |
| 6     | Discord activity, XP and levels             | Done   |
| 7     | Automatic roles                             | Done   |
| 8     | Leaderboards                                | Done   |
| -     | Stream attendance capture                   | Done   |
| 9     | Rewards                                     | Done   |
| 10    | Challenges                                  | Next   |
| 11    | Achievements                                | Todo   |
| 12    | Moderation                                  | Todo   |
| 13    | Analytics                                   | Todo   |

### Known gaps in V1

- **Watch time** is never collected. Discord exposes no watch telemetry, so
  hours-watched is not offered as a role rule or a reward condition.
- **Giveaway entries** have no `Giveaway` entity to record against, so that
  reward action is not offered.
- **Membership-age roles and rewards** are evaluated on join and on activity,
  not on a daily sweep. A silent member misses the threshold until they
  interact.
- **`/dashboard/xp`** is listed in the sidebar but not built. XP settings are
  editable in the database only.

See `PRD.md` and `IMPLEMENTATION_PLAN.md` for the full requirements.

## Security notes

- Secrets live in `.env.local`, which is gitignored. `.env.example` holds
  placeholders only.
- Bot tokens, OAuth secrets and provider tokens are only read in server code.
  Nothing secret is sent to the browser.
- The session is an HMAC-signed cookie (`AUTH_SECRET`), httpOnly and
  sameSite=lax, valid for seven days. Expiry is checked with `io()` rather
  than `connection()`: under Cache Components, `io()` is the documented way
  to keep a clock read out of the static shell.
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
- The alert settings form verifies the chosen channel and role against the
  guild's real channel and role list before saving, so a tampered form
  cannot point alerts at another server's channel.
- `STREAM_POLL_SECRET` protects the polling endpoint, which can post to
  Discord on your behalf.

## Bot permissions

See **Running the bot** above. Run `/setup` in your server to check what is
missing — it reports on both intents' worth of permissions and whether the bot
is in the server the dashboard expects.

Grant the role Komu uses to manage other roles below the highest role it needs,
so it cannot escalate privileges. A role above the bot's highest role can never
be assigned, and Komu reports that as a hierarchy error rather than failing
silently.
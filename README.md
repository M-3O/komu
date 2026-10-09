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
| `npm run test:integration` | Integration tests, needs a database    |
| `npm run check:bot`   | Verify the bot's imports load cleanly        |
| `npm run verify`      | Everything above, plus a production build    |
| `npm run db:migrate`  | Create and apply a migration in development |
| `npm run db:deploy`   | Apply migrations in production              |
| `npm run db:seed`     | Load test data                              |
| `npm run db:studio`   | Browse the database                         |
| `npm run db:reset`    | Drop, re-migrate and re-seed                |

## Streaming integrations

Provider APIs are isolated behind one interface, so nothing outside
`src/lib/twitch`, `src/lib/youtube` and `src/lib/kick` needs to know any
provider's response shape. Callers get a `StreamInfo`:

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

Channels are connected by typing an identifier on `/dashboard/streams`. It is
resolved through the provider before anything is stored, so Komu saves the
provider's own ids and display name rather than whatever was typed.

Accepted for each provider:

- **Twitch** — a login or a channel id
- **YouTube** — a channel id, an `@handle`, or any YouTube URL (watch, channel,
  or the legacy `/c/` and `/user/` paths)
- **Kick** — a slug, an `@name`, or any kick.com URL

### YouTube setup

Create OAuth credentials in the Google Cloud Console, enable the **YouTube Data
API v3**, and set `YOUTUBE_CLIENT_ID`. The client id doubles as the API key; the
secret is unused, because a public API key needs no OAuth flow.

**Read the quota note below before setting a poll interval.** Checking whether
a YouTube channel is live costs 101 quota units per poll.

### Kick setup

Create an application at <https://kick.com/settings/developer> and set
`KICK_CLIENT_ID` and `KICK_CLIENT_SECRET`. Komu requests only the read-only
`channel:read` and `livestream:read` scopes.

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

Configured on `/dashboard/xp`:

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

A `xpDailyCap` of **zero means no limit**, matching what `applyDailyCap`
actually does. A `xpMessageCooldownSecs` of zero likewise disables the
cooldown.

**The page shows what the numbers imply.** Typing a daily cap updates a live
panel: how many messages a member can actually earn from per day, and which of
the two limits is doing the work. A creator choosing 200 XP per day with 15 XP
per message has not realised that caps them at 13 messages a day; showing the
consequence is more useful than refusing the value, since the value may well
be deliberate.

**Turning XP off does not reset anyone's progress.** It stops new awards from
messages; attendance, rewards, challenges and achievements still pay out, and
existing XP and levels are untouched. Verified live against the seeded members.

### The level curve

```
xpForLevel(N) = 100 * N * (N + 1) / 2
```

Level 2 at 100 XP, level 5 at 750, level 10 at 2,750, level 25 at 16,250. The
curve is the same for every server and is not configurable — only the XP per
message is, so the page shows the curve alongside what the current award is
worth in messages.

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

## Challenges

A challenge is a structured, time-bounded goal with one or more
requirements. All of them must be met.

```text
Attend 3 streams
+ Send 20 messages
+ Reach level 5
        =
Challenge complete
        =
250 XP and the @Challenge Winner role
```

### Progress counts from the start of the challenge

This is what separates a challenge from a reward. A reward checks a member's
lifetime total; a challenge counts what they did **during** the challenge. So
progress lives on `ChallengeProgress` in its own counters, not derived from
`GuildMember.messageCount`.

Creating a challenge today does not credit a member with last month's
messages. Verified against the live database: a member with 500 messages and
20 stream attendances started a fresh challenge at zero.

Progress rows are created on a member's first relevant activity, not when the
challenge is created, so setting one up does not write a row for every member
in the server.

### Requirements

`Attend N streams`, `Send N messages`, `Reach level N`.

Hours watched is not offered, for the same reason it is not offered as a role
rule or a reward condition: nothing collects watch time, so the challenge
could never be completed.

A **level** requirement is read from the member rather than counted, because a
level never decreases. That means level challenges are re-checked on every
activity — levels rise from messages and attendance, so checking only on join
would leave them uncompletable for anyone who levelled up by messaging.

A challenge with **no requirements** is never complete and gets no progress
rows. Completing it would be indistinguishable from being paid for nothing.

### When progress is checked

A qualifying message, a recorded stream attendance, and a member joining. That
is the same three events that drive roles and rewards, all through
`bot/services/progression.ts`.

An activity that no requirement of a challenge asks for writes nothing for
that challenge. On a busy server most messages concern no challenge at all,
and those skip the database entirely.

### Expiry

Progress stops being recorded once `endsAt` has passed. Rows are left alone
rather than deleted, so a member can still see how far they got. No scheduled
job is needed: expiry is checked when activity arrives.

### Payout

A member who completes a challenge gets `xpReward` and, if configured, a
Discord role. The payout bypasses the daily XP cap: finishing a challenge is a
deliberate reward, not something earned by grinding messages.

`rewardGivenAt` makes it exactly once. It is set even when the role could not
be assigned, so a role above the bot's highest role does not retry — and
inflate XP — on every subsequent message.

### Member view

`/challenge` in Discord shows the caller's progress on the current
challenges. Challenges have no announcement channel configured, so this is
where a member finds out how they are doing rather than waiting to be told.

## Achievements

A permanent milestone: a name, description, icon, and one requirement measured
against everything a member has ever done.

```text
OG Member — Been in the server for 30 days
🏆 100 XP
```

### An achievement is a lifetime check, a challenge is a window

This is the only structural difference, and it decides where the numbers come
from. A challenge counts what happened during a window, so it keeps its own
counters. An achievement reads `GuildMember` totals directly, so it reuses the
same `metricValue` from `lib/progression/metrics.ts` that roles and rewards
use. Nothing is stored per member per achievement until they unlock it.

`FIRST_STREAM` maps onto the ordinary attendance counter with a threshold of 1,
rather than getting a code path of its own.

### Unlocking pays out exactly once, and that is decided by the insert

The unique constraint on `(achievementId, memberId)` is what makes an
achievement one-shot. The insert uses `createMany({ skipDuplicates: true })` and
its returned row count decides the payout:

- count 1 → this call was first, so award the XP and role
- count 0 → somebody else unlocked it in between, so pay nothing

That ties paying out to actually being first, instead of checking and then
writing as two steps that can disagree. It is also why `skipDuplicates` matters
more here than catching the error would: on a busy server a re-check after a
member has unlocked something is the normal case, and a caught unique-violation
would log an error every time.

### Hidden achievements

A hidden achievement is not shown to a member until they unlock it, and its
count is not revealed either, since that would leak that there is something to
find. Unlocking still works normally — hiding affects display only.

### Member view

`/achievements` shows unlocked achievements and how far through the locked ones
each member is. Unlocked achievements also appear on `/profile`, which already
did so from Phase 6.

## Moderation

Three automatic rules and five manual commands, all configured from the
dashboard and enforced by the bot.

### Word filter

Case-insensitive, **whole-word** matching. Whole-word matters: blocking "ass"
must not also delete "class", "assignment" and "pass", because a filter that
catches innocent words is how members leave.

```text
Blocked: badword, spam-link, free nitro

"this is a badword"        -> matched
"I am in a classroom"      -> clean (contains "ass", but not as a word)
"nothing here"             -> clean
```

Regex characters in a blocked word are escaped, so `c++` or `a.b` are matched
literally instead of throwing on every message.

**Boundaries are ASCII, not Unicode.** That is a deliberate tradeoff. Unicode
letter boundaries would be more precise, but they mean a blocked word followed
by any CJK character does not match — so the entire filter can be evaded by
typing one extra character, and the creator has no way to see why their filter
stopped working. Silent evasion is worse than the rare false positive. ASCII
still protects the case that matters.

An empty entry in the word list is ignored, because a trailing comma in the
form is the easy way to produce one, and an empty entry would otherwise match
every message.

### Spam protection

N messages inside a window. The window is at least 60 seconds, because a
shorter one times out ordinary conversation.

### Anti-raid

N joins inside a window, after which the accounts that joined in that window
are **timed out**. Nothing is banned automatically: a join spike has innocent
explanations, and auto-banning is how a protection tool becomes the incident.
The server owner is never timed out — that would lock the creator out during
the incident they are trying to handle.

### Rate and spike counting is in memory

Timestamps live in a `Map` in the bot process, not in the database. A flood is
a burst; writing every message timestamp to Postgres to notice one would cost
more than it is worth.

The trade-off: the window **resets when the bot restarts**, which means a brief
lapse right after a deploy rather than a way past the filter on purpose. Keys
are pruned periodically so a spammy account cannot grow the map without bound.

### Moderation runs before XP

A message the word filter deleted does not earn XP. Otherwise a spammer is
rewarded for exactly the behaviour the filter exists to stop.

### Warnings

Warnings are `ModerationActionRecord` rows of type `MANUAL_WARN`, as the schema
documents, rather than a separate table.

- `/warnings` lists them, newest first, marking cleared ones
- `--clear` stamps `warningClearedAt` rather than deleting, so the count drops
  but the history survives

### The audit trail outlives its rules

Deleting a moderation rule nulls `ruleId` on the records it caused
(`onDelete: SetNull`) instead of cascading them away. A moderation history that
disappears when its rule is tidied up is useless for asking "what happened
last week".

### Manual commands

`/warn`, `/warnings`, `/timeout`, `/kick` and `/ban`. All need `Administrator`,
read from the caller's live Discord permissions.

Each checks twice before acting: the caller needs `Administrator`, **and** the
bot must be able to moderate the target. Discord happily accepts a request to
ban someone the bot cannot touch, so the second check turns a confusing API
error into a sentence a moderator can act on. The message names the likely
cause: bot role below the target's, or a missing permission.

## Analytics

Plain Prisma aggregates over data the application already stores. No
warehouse, no event bus, no analytics cache — the plan rules those out for V1,
and for one server's worth of data they would be infrastructure to maintain
rather than speed worth having.

### Cards and the chart read the same rows

The totals and the daily buckets come from one query of `XPTransaction`, so a
card and its graph cannot disagree. Verified live: both reported 6 messages and
80 XP.

### Only message XP counts as activity

A `REWARD`, `ACHIEVEMENT` or `CHALLENGE` transaction is a payout, not activity.
Counting them would report a quiet day as a busy one. A 500 XP reward payout on
the same day as 80 XP of messages reads as 80, not 580.

The caveat is printed on the page: messages counted here are the ones that
earned XP, so the number is lower than every message sent. Same honesty as the
leaderboards.

### Days are whole UTC days

`rangeStart` snaps to UTC midnight. A window ending at midday would otherwise
span one more calendar date than its name suggests — "last 7 days" would draw
eight bars — and a partial first day would put the cards and the chart on
different boundaries.

UTC rather than local time because otherwise an event lands in a different
bucket depending on where the server runs.

### Quiet days are drawn, not skipped

`emptyBuckets` fills the whole range with zeroed days. Without that a chart
draws a straight line from Monday to Friday over a silent weekend, which reads
as steady activity rather than two quiet days.

An unrecognised range falls back to 30 days. It does not produce an invalid
date, because that would return no bars at all — and a chart with no bars reads
as "no activity" rather than "bad request".

### The chart is hand-drawn SVG

No charting library. The shape needed is a bar per day, and a dependency would
bring hundreds of kilobytes and an API to learn for arithmetic that fits in one
function. Bars scale against the largest day in the range, so a quiet week is
not a flat line at the bottom.

### Watch time is listed, not omitted

The PRD asks for it and there is no data source, so the page shows it under
"Not available yet" with the reason. A card reading zero would imply it was
measured and found to be zero.

### YouTube quota: read this before choosing a poll interval

YouTube charges per request out of a daily allowance, and the two calls cost
very different amounts:

| Call | Units |
| ---- | ----- |
| `channels.list` (resolve a handle or id) | 1 |
| `videos.list` (is this broadcast running) | 1 |
| `search.list` (find the live video) | **100** |

Asking whether a channel is live needs `search.list`, so **every YouTube poll
costs 101 units**. The default daily allowance is 10,000, which means a
60-second poll interval exhausts it in **under two hours** and then YouTube
stops answering for the rest of the day.

Use **`STREAM_POLL_INTERVAL_SECS=300`** (five minutes) or longer when YouTube is
connected. Five minutes costs about 29,000 units a day for one channel, so even
that needs a quota increase on a default project. A creator watching for the
instant a stream goes live should use Twitch or Kick instead.

A missed poll is not a missed alert: the next successful poll still reports the
stream as live, so a longer interval delays the alert rather than losing it.

### Both new providers authenticate without the creator's account

Twitch uses an app token, YouTube an API key (the client id), and Kick the
application's client credentials with read-only scopes. In every case the
creator never has to connect their streaming account to Komu, and neither
`channel:write` nor any equivalent is ever requested.

### What each provider can and cannot report

| | Twitch | YouTube | Kick |
| --- | --- | --- | --- |
| Category / game | yes | no | no |
| Viewer count | yes | yes | yes |
| Thumbnail | yes | yes | no |
| Start time | yes | yes | yes |

Where a provider has no field, `StreamInfo` gets `null` rather than a guessed
URL. A guessed thumbnail would render as a broken image, which is worse than an
absent one.

YouTube thumbnails are walked largest-first because `maxres` only exists for
high-resolution uploads, so picking a fixed key would hand a 120px image for most
channels. YouTube titles arrive HTML-escaped, so `Bob&#39;s Stream` is decoded
to `Bob's Stream` before it reaches Discord.

### Live detection differs per provider, deliberately

- **Twitch** returns an empty array when the channel is offline.
- **YouTube** keeps `liveStreamingDetails` on a broadcast *after* it ends, so
  presence of that block is not enough — an `actualEndTime` means it finished.
  Without that check every past stream would re-alert.
- **Kick** only includes a `livestream` block while the channel is live, so
  absence is the signal. `is_live` is checked as well, in case a block is
  present but stale.

## Tests

Two suites, because they need different things.

| Command | Needs | What it covers |
| ------- | ----- | -------------- |
| `npm test` | nothing | Pure logic: level maths, eligibility rules, normalisation, validation |
| `npm run test:integration` | `DATABASE_URL` | Constraints, transactions and one-shot guarantees |

`npm test` runs on every commit and needs nothing. Integration tests need a
real database because the things they check are only answerable against one:
a unique constraint either holds or it does not, two writes either race or they
do not, a transaction either rolls back or it does not.

**Integration tests write, so point them at a development database.** Each test
builds its own rows from a unique seed and removes them afterwards, and the
suite runs serially, but it is not safe against production.

### The bugs they exist to catch

Every one of these produced wrong numbers or no output, with no error anywhere:

- A Discord snowflake passed where a database member id was expected. Every
  query matched nothing, so **no challenge reward was ever paid out**.
- An achievement re-awarding its XP on every check.
- Two copies of a member's XP drifting apart.
- Attendance counted more than once from repeated reactions.

The second file is named `uniqueness.integration.test.ts` because that is what
it is about: the one-shot guarantees, proven by the database rather than
assumed from reading the code.

### A silent hazard worth knowing about

`awardXp` with a member id that does not exist returns `{ awarded: 0 }` rather
than throwing. That reads like "the member was capped" rather than "you passed
the wrong id", which is exactly how the snowflake bug stayed hidden for a
whole phase. There is a test asserting the current behaviour, so changing it to
throw would be a visible, deliberate change.

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
│   ├── achievements/ Achievement conditions and unlocking
│   ├── analytics/  Aggregates, date ranges and daily bucketing
│   ├── auth/       Sessions, Discord OAuth, permission checks
│   ├── challenges/ Challenge progress, completion and payouts
│   ├── config/     Environment validation
│   ├── dashboard/  Dashboard queries and navigation
│   ├── db.ts       Shared Prisma client
│   ├── guilds/     Discord server access
│   ├── discord/    REST calls (channels, roles, posting)
│   ├── leaderboards/ Periods and ranking queries
│   ├── levels/     Level maths
│   ├── logger.ts   Logging
│   ├── moderation/ Word filter, rate limits, raids, warnings
│   ├── progression/ Shared metric maths used by roles and rewards
│   ├── rewards/    Reward evaluation, granting and history
│   ├── roles/      Role rule evaluation and assignment
│   ├── streams/    Provider interface, live status, alert polling
│   ├── twitch/     Twitch Helix client and normaliser
│   ├── youtube/    YouTube Data API client and normaliser
│   ├── kick/       Kick public API client and normaliser
│   └── xp/         XP awards, daily window, anti-abuse rules, settings
├── instrumentation.ts  Starts the optional in-process poller
├── bot/            Discord bot (its own process)
│   ├── index.ts      Entry point
│   ├── config.ts     Intents and credentials
│   ├── commands/     Slash command definitions and handlers
│   ├── events/       Gateway event handlers
│   ├── permissions.ts  Live Discord permission checks
│   ├── services/     Progression (roles, rewards, challenges), moderation
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
| `/challenge` | Your progress on the current challenges. |
| `/achievements` | Your achievements and what is still locked. |
| `/reward` | Grant a reward to a member by hand. Needs `Administrator`. |
| `/warn` | Warn a member. Needs `Administrator`. |
| `/warnings` | Show or clear a member's warnings. Needs `Administrator`. |
| `/timeout` | Time a member out. Needs `Administrator`. |
| `/kick` | Remove a member. Needs `Administrator`. |
| `/ban` | Ban a member. Needs `Administrator`. |

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

Phases 0 to 14 are done, including 4b, along with the integration half of
Phase 15. What remains is the manual test pass in Phase 15, which needs a real
Discord server.

| Phase | Scope                                       | Status |
| ----- | ------------------------------------------- | ------ |
| 0     | Project setup                               | Done   |
| 1     | Database foundation                         | Done   |
| 2     | Discord OAuth                               | Done   |
| 3     | Discord bot foundation                      | Done   |
| 4     | Streaming integrations (Twitch 1st)         | Done   |
| 4b    | Streaming integrations (YouTube, Kick)      | Done   |
| 5     | Stream alerts                               | Done   |
| 6     | Discord activity, XP and levels             | Done   |
| 7     | Automatic roles                             | Done   |
| 8     | Leaderboards                                | Done   |
| -     | Stream attendance capture                   | Done   |
| 9     | Rewards                                     | Done   |
| 10    | Challenges                                  | Done   |
| 11    | Achievements                                | Done   |
| 12    | Moderation                                  | Done   |
| 13    | Analytics                                   | Done   |
| 14    | Dashboard polish                            | Done   |
| 15    | Testing (integration suite)                 | Done   |
| 15    | Testing (manual, needs a live server)       | Todo   |

### Known gaps in V1

- **Watch time** is never collected. Discord exposes no watch telemetry, so
  hours-watched is not offered as a role rule or a reward condition.
- **Giveaway entries** have no `Giveaway` entity to record against, so that
  reward action is not offered.
- **Membership-age roles and rewards** are evaluated on join and on activity,
  not on a daily sweep. A silent member misses the threshold until they
  interact.
- **Challenges have no announcement channel.** A completion is logged and
  appears on the dashboard and in `/challenge`, but nothing is posted to
  Discord automatically. `Challenge` has no channel column to post to.
- **Rate and join-spike windows reset when the bot restarts.** They are counted
  in memory rather than written to the database. A brief lapse after a deploy,
  not a way past the filter.
- **Moderation commands need `Administrator`.** A server that wants a separate
  Moderator role cannot have one yet.
- **YouTube polling is quota-bound.** Every poll costs 101 units against a
  default 10,000 per day, so the interval must be five minutes or longer. This
  is YouTube's pricing, not a Komu limit.
- **Nothing is verified against a live Discord server.** The OAuth round trip,
  bot login, alert delivery, the 14 slash commands and the YouTube and Kick API
  calls all need real credentials. What is verified is the logic behind them,
  against the live database. Phase 15's manual test pass is still outstanding
  for this reason.
- **`awardXp` fails silently on an unknown member id.** It returns
  `{ awarded: 0 }` rather than throwing, which is indistinguishable from the
  member being capped. See "Tests" above.

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

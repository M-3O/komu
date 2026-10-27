# Komu — Security Review

**Scope:** full codebase audit of `komu` (Next.js 16 App Router + discord.js v14 + Prisma/PostgreSQL)
**Date:** 2026-10-11
**Method:** line-by-line read of all 170 tracked source files, `npm audit`, git history inspection, and targeted verification of every finding against the actual source.

**Status (2026-10-24):** every CRITICAL, HIGH and MEDIUM finding is fixed, along with all LOW findings except the Prisma CLI advisory in #27. This document is kept as the record of what was wrong and why the fixes look the way they do.

---

## Brief points (start here)

- **Two critical broken-access-control bugs.** The dashboard checks *authentication* (is there a valid session?) but never *authorization* (do you administer this server?). Any person who can sign in with Discord — even one who admins no server at all — can rewrite your entire configuration. `canAccessPrimaryGuild()` already exists and is correct; it is simply **never called**.
- **Anyone can hijack your installation.** `/setup` overwrites the connected server if one already exists, without checking that the caller owns it. Anyone who admins *any* Discord server (even a throwaway) can repoint Komu at it.
- **No SQL injection anywhere.** Zero raw queries in the entire project; Prisma's query builder everywhere. This is a genuine structural strength — do not regress it.
- **No SSRF.** All five outbound clients use compile-time-constant base URLs; user input only reaches `URLSearchParams`/`encodeURIComponent`.
- **OAuth and session crypto are correct.** HMAC-SHA256, constant-time compare, `httpOnly` + `SameSite=Lax` + `secure`, 32-byte random `state`, single-use state cookie. Both open-redirect vectors (`//` and `/\`) are handled. These are well built.
- **The Discord bot layer is better protected than the web dashboard.** Every mutating command goes through one fail-closed permission helper. The dashboard is where the real gap is.
- **Rewards/XP have three concurrency races** — double-grant of one-shot rewards, and XP totals that permanently drift from their own transaction ledger. The correct fix pattern already exists in your codebase (used by achievements and attendance).
- **Discord OAuth tokens are stored in plaintext** in the database, while a schema comment claims they're encrypted. They are not — unless you happen to pay for a managed Postgres with disk encryption. They are also never revoked on logout.
- **Sessions can't be revoked.** Stateless HMAC with a 7-day TTL and no `Session` table means a stolen cookie stays valid for a week, and rotating `AUTH_SECRET` logs out every user.
- **`AUTH_SECRET` length is validated in the wrong place.** The `.min(32)` rule sits in the Zod schema, but the signing path uses a separate lenient getter that accepts a 1-character key.
- **No security headers at all** — no CSP, HSTS, `X-Frame-Options`, or `X-Content-Type-Options`. The dashboard is clickjackable, and it contains single-click destructive mutations.
- **The internal poll endpoint mutates state on `GET` and accepts its secret in the URL query string**, leaking it to access logs and `Referer` headers.
- **Availability risks:** not one of the 9 `fetch()` calls has a timeout, and the poller's `setInterval` has no in-flight guard — a slow provider compounds cycles until the daily YouTube quota is gone.
- **Dependencies are clean at runtime.** All 8 `npm audit` highs are in the Prisma CLI and ESLint toolchain (dev-only, DoS-via-glob), not in `next`, `react`, or `discord.js`.

**Bottom line:** the cryptography, injection-resistance, and Discord-side permission model are solid. The failure is a single systemic one — **authorization is enforced only during `/setup` and nowhere else** — plus several concurrency and hardening gaps. The top two fixes are each a handful of lines.

---

## Severity summary

| # | Severity | Finding | Location |
|---|----------|---------|----------|
| 1 | **CRITICAL** | Dashboard actions never authorize — any signed-in user administers any guild | `dashboard/*/actions.ts` (8 files) |
| 2 | **CRITICAL** | `/setup` lets any user repoint the whole installation | `app/setup/actions.ts:40-52` |
| 3 | **HIGH** | Reward double-grant: no unique constraint + read-then-write across network calls | `schema.prisma:594`, `rewards/grant.ts` |
| 4 | **HIGH** | XP lost-update race — totals permanently drift from ledger | `xp/award-xp.ts:83,151,166` |
| 5 | **HIGH** | XP cooldown bypass via TOCTOU race | `xp/message-xp.ts:193-264` |
| 6 | **HIGH** | Discord OAuth tokens stored in plaintext | `schema.prisma:183`, `callback/route.ts:69` |
| 7 | **HIGH** | Mutating `GET` endpoint + secret accepted in query string | `api/internal/poll-streams/route.ts:32,44-46` |
| 8 | **HIGH** | Bot `/setup` has no permission check; leaks configured server name cross-guild | `bot/commands/setup.ts:33,72-74` |
| 9 | **HIGH** | Cross-tenant `GuildMember` lookup — no `guildId` filter | `bot/commands/moderate.ts:146-149` |
| 10 | **HIGH** | No `AbortSignal`/timeout on any of 9 `fetch()` calls | `twitch/client.ts`, `kick/client.ts`, `youtube/client.ts`, `discord/rest.ts` |
| 11 | **HIGH** | `setInterval` poller with no in-flight guard | `streams/poller-runtime.ts:43` |
| 12 | **MEDIUM** | No security headers (CSP/HSTS/X-Frame-Options) | `next.config.ts` |
| 13 | **MEDIUM** | `error.message` rendered to client in both error boundaries | `app/error.tsx:38`, `dashboard/error.tsx:46` |
| 14 | **MEDIUM** | No input length bounds or numeric ceilings in any server action | `dashboard/*/actions.ts` |
| 15 | **MEDIUM** | `NEXT_PUBLIC_APP_URL` fails open to `http://localhost:3000` | `config/server-config.ts:26-29` |
| 16 | **MEDIUM** | `getAnalytics` / `getSetupChecklist` skip the codebase's own auth boundary | `analytics/queries.ts:61`, `dashboard/setup-checklist.ts:34` |
| 17 | **MEDIUM** | Missing DB indexes on two hot queries | `schema.prisma:374-378,466` |
| 18 | **MEDIUM** | No server-side session revocation — a stolen cookie is valid 7 days, even after logout | stateless design; no `Session` model |
| 19 | **MEDIUM** | Discord token never revoked on logout; stays live in the DB indefinitely | `(auth)/logout/route.ts` |
| 20 | **MEDIUM** | `getAuthSecret()` skips the 32-char minimum on the actual signing path | `config/server-config.ts:75-78` |
| 21 | **MEDIUM** | No rate limiting on any auth endpoint; `/callback` is an amplification vector | `api/auth/login`, `(auth)/callback` |
| 22 | **LOW** | No PKCE | `auth/discord-oauth.ts:57-86` |
| 23 | **LOW** | `STREAM_POLL_SECRET` has no entropy floor; absent from Zod schema | `config/server-config.ts:15-41` |
| 24 | **LOW** | Dead `isGuildAdmin` column — written, never read | `schema.prisma:187` |
| 25 | **LOW** | `logout` redirect derives origin from the `Host` header | `(auth)/logout/route.ts:15` |
| 26 | **LOW** | Cookies lack `__Host-` prefix (subdomain cookie-tossing) | `auth/session.ts:24` |
| 27 | **LOW** | 8 high-severity dev-dependency advisories | `package-lock.json` |

---

## Detailed findings

### 1. CRITICAL — Dashboard server actions perform no authorization

**Every** dashboard mutation authenticates the caller but never checks that the caller may administer the server they are mutating.

The pattern is repeated verbatim in 8 action files (`moderation:30-41`, `alerts:34-47`, `achievements:32-43`, `challenges:32-43`, `rewards:31-42`, `roles:29-40`, `xp:30-41`, `streams:27-29`):

```ts
async function requireGuild() {
  await requireCurrentUser("/dashboard/moderation");   // ← authentication only
  const guild = await prisma.guild.findFirst({
    orderBy: { createdAt: "asc" },                      // ← first guild in the whole table
    select: { id: true, name: true, discordId: true },
  });
  if (!guild) throw new Error("No Discord server is connected yet.");
  return guild;                                         // ← caller never checked against it
}
```

`requireCurrentUser` returns a `userId`. **That `userId` is discarded in every `requireGuild()`.**

Meanwhile the correct helper exists, is well written, and has **zero call sites** (verified by repo-wide grep):

```ts
// src/lib/auth/current-user.ts:144
export async function canAccessPrimaryGuild(userId: string): Promise<boolean> {
  const guild = await prisma.guild.findFirst({ orderBy: { createdAt: "asc" }, select: { discordId: true } });
  if (!guild) return false;
  return (await verifyGuildAccess(userId, guild.discordId)) !== null;
}
```

**Attack path:** sign in with any Discord account → `GET /dashboard` (the layout at `dashboard/layout.tsx:34` calls only `requireCurrentUser`) → invoke any server action. You can create/edit/delete moderation rules (including `BAN`/`KICK`/`TIMEOUT`), rewards, challenges, role rules, achievements, XP settings, and alert configuration — and repoint alerts at arbitrary channels. `sendTestAlertAction` additionally lets you send arbitrary Discord messages on demand.

`verifyGuildAccess` (which does a live Discord check) is called from exactly one place: `setup/actions.ts:24`.

**Fix** — one change per file, using the value already returned:

```ts
async function requireGuild() {
  const user = await requireCurrentUser("/dashboard/moderation");
  if (!(await canAccessPrimaryGuild(user.userId))) {
    throw new Error("You do not administer the connected server.");
  }
  return prisma.guild.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
}
```

Then add the same check to `dashboard/layout.tsx` so unauthorized users never render the shell.

---

### 2. CRITICAL — `/setup` allows installation takeover

`app/setup/actions.ts` correctly validates that the submitted guild is one the caller administers (`verifyGuildAccess`, line 24). But then:

```ts
const existing = await tx.guild.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } });
if (existing) {
  await tx.guild.update({
    where: { id: existing.id },
    data: { discordId: access.id, name: access.name, iconHash: access.icon,
            ownerId: user.userId, setupCompletedAt: new Date() },   // ← no ownership check
  });
  return;
}
```

There is no check that the caller is the current `ownerId`. **Anyone who administers *any* Discord server can POST their own server id and repoint the entire installation**, inheriting `ownerId` and orphaning the legitimate operator's configuration. Because `guild.findFirst({orderBy:{createdAt:"asc"}})` is the global "primary guild" lookup used by all 8 dashboard files, this is a full takeover.

The login callback makes this reachable: it correctly detects a non-admin (`callback/route.ts:90-98`) but only **redirects** them to `/setup` — it never denies them — where this action awaits.

**Fix:** before the `if (existing)` branch, re-verify against the *existing* guild:

```ts
if (existing) {
  const mayReplace = await verifyGuildAccess(user.userId, existing.discordId);
  if (!mayReplace) return { error: "Another account owns this installation." };
  // ...proceed
}
```

---

### 3. HIGH — Reward double-grant (no unique constraint)

`schema.prisma:594` declares a plain **index**, not a unique constraint:

```prisma
model RewardGrant {
  @@index([rewardId, memberId])     // ← should be @@unique
}
```

Compare `MemberAchievement` at `schema.prisma:726`, which correctly uses `@@unique([achievementId, memberId])`. The codebase already knows the right pattern — `unlock.ts:101-114` uses `createMany({ skipDuplicates: true })` and gates on `created.count === 0`.

`grant.ts` does **not**. Its read-then-write window spans **Discord API calls** (`grant.ts:87-94` read → `:194-197` execute → `:199-207` write). Two concurrent calls both read zero grants, both find the one-shot reward eligible, and both execute — double XP *and* a duplicate grant row.

**Fix:** add `@@unique([rewardId, memberId])`, migrate, then use `createMany({ skipDuplicates: true })` and check `created.count`.

---

### 4. HIGH — XP lost-update race

`xp/award-xp.ts` wraps its work in `prisma.$transaction`, but the body is read-then-write with **no row lock**, and Prisma defaults to Postgres `READ COMMITTED`:

```ts
const member = await tx.guildMember.findUnique({ select: { xp: true, xpToday: true } });
const totalXp = Math.max(previousTotal + amount, 0);
await tx.guildMember.update({ where: { id: member.id }, data: { xp: totalXp } });
```

Two concurrent awards both read `xp = 1000`, both write `1015`, but both insert a `+15` transaction row. `sum(xp_transactions) = 1030` while `guild_members.xp = 1015` — a **permanent** silent divergence, contradicting the module's own docstring ("Both are written in one transaction so they cannot drift"). The daily cap (`xpToday`) is undermined identically.

**Fix:** `SELECT ... FOR UPDATE` inside the transaction, or `{ isolationLevel: Prisma.TransactionIsolationLevel.Serializable }`, or an atomic `increment` + re-read.

---

### 5. HIGH — XP cooldown bypass (TOCTOU)

`bot/events/message-create.ts:20-22` dispatches with `void onMessage(...)` — no serialization. Within `handleMessageActivity`, the eligibility read and the state write are separated by several round trips:

- L193-218 `upsert` returns `lastXpMessageAt`
- L223-231 `evaluateEligibility({ lastXpMessageAt: member.lastXpMessageAt })`
- L249 `awardXp(...)`
- L259-264 **only then** `update({ lastXpMessageAt: new Date() })`

Two messages inside one cooldown window both read the stale value and both award XP. With a 60s default cooldown, a burst of N messages yields up to N× the intended XP. `lastMessageRepeatCount` has the identical shape, so the anti-spam rule is bypassable the same way.

**Fix:** perform the cooldown check and the stamp in one conditional `updateMany({ where: { id, lastXpMessageAt: { lt: cutoff } }, data: { lastXpMessageAt: now } })` and award only if `count === 1`.

---

### 6. HIGH — Discord OAuth tokens stored in plaintext

`schema.prisma:183` stores the Discord access token as a plain nullable string, written at `callback/route.ts:69`. The schema comment at `schema.prisma:321` states:

> *"Tokens are stored encrypted-at-rest by the database provider."*

That is an **assumption about your hosting provider**, not a property of the application. `provider = "postgresql"` is a stock Postgres; disk encryption is off unless you bought a managed service that includes it. There is **no application-level encryption** anywhere in `src/`.

A stolen `DATABASE_URL`, a leaked `pg_dump`, a backup file, or a read-only SQLi elsewhere yields live `identify` + `guilds` tokens for every dashboard user.

**Fix:** encrypt with AES-256-GCM before write, key from `AUTH_SECRET` (or a dedicated `TOKEN_ENCRYPTION_KEY`). You already have the primitive pattern in `session-crypto.ts` (HMAC + `timingSafeEqual`) to follow. Note `DiscordAccount.tokenExpiresAt` is also never written, even though `expires_in` is returned — set it so tokens can be refreshed rather than left dangling.

---

### 7. HIGH — Mutating GET endpoint + secret in query string

```ts
// api/internal/poll-streams/route.ts
export async function GET(request: Request) {          // ← state-changing verb
  const provided =
    request.headers.get("x-poll-secret") ??
    new URL(request.url).searchParams.get("secret");   // ← secret in URL
  ...
  const result = await runStreamDetectionCycle();      // posts to Discord
  return Response.json(result);
}
```

Three problems:
1. **`GET` mutates** — posts real Discord messages. CSRF-triggerable by an `<img src>`, and cacheable/prefetchable.
2. **`?secret=` leaks** into proxy/CDN access logs, shell history of the cron job, and `Referer` headers. The README documents only the header form, so this is an undocumented, unnecessary widening.
3. **No rate limiting, lockout, or IP-attempt logging** on rejection (`route.ts:49` logs a fixed string with no IP).

Impact if the secret leaks: arbitrary-volume Discord posts, unbounded provider API traffic (YouTube `search.list` is 100 units per poll), and DB pool exhaustion.

**Fix:** switch to `POST`, accept only `x-poll-secret`, require a ≥32-char secret, and rate-limit failed attempts.

---

### 8. HIGH — Bot `/setup` has no permission check and leaks cross-guild

`bot/commands/setup.ts:33` `handleSetup` contains **no** `isGuildAdmin` call, unlike `moderate.ts:120` and `reward.ts:96`. Any member of any guild the bot is in can run it. Worse, it reads the *global* single-row guild (`setup.ts:38`) rather than the caller's guild, then discloses:

```ts
"This installation is configured for **${guild.name}**, not this server."
```

That leaks your configured server name to an outsider. Inside the correct guild, lines 84-97 disclose streaming providers and usernames to any member.

**Fix:** gate the whole handler on `isGuildAdmin(interaction)`.

---

### 9. HIGH — Cross-tenant member lookup in moderation

```ts
// bot/commands/moderate.ts:146
const dbMember = await prisma.guildMember.findFirst({
  where: { discordId: discordMember.id },      // ← no guildId filter
  select: { id: true, guild: { select: { id: true } } },
});
```

`GuildMember.discordId` is **not** globally unique — the constraint is `@@unique([guildId, discordId])` (`schema.prisma:292`). The returned `dbMember.guild.id` then flows into `warnMember`, `clearWarnings`, `listWarnings` and `recordAction` as the authoritative tenant key. With no `orderBy`, `findFirst` is non-deterministic.

Currently latent because V1 enforces a single guild row — but the schema explicitly anticipates multi-guild. Compare the correct pattern at `reward.ts:125-128`.

**Fix:** resolve the DB guild by `discordId: interaction.guildId`, then filter `{ guildId: dbGuild.id, discordId: target.id }`.

---

### 10. HIGH — No timeout on any outbound request

Repo-wide grep for `AbortController` / `signal:` across `src/lib/{twitch,youtube,kick,discord,auth}` returns **zero matches**. All 9 `fetch()` sites are unbounded.

This compounds badly in the poller: `poller.ts:71-88` iterates channels **sequentially**, so one hung fetch stalls the cycle forever. With no in-flight guard (finding 11), each tick starts another full cycle that also hangs — unbounded pile-up of in-flight promises and DB pool checkouts.

**Fix:** an `AbortSignal.timeout(8_000)` on every fetch, or a shared wrapper.

---

### 11. HIGH — `setInterval` poller with no in-flight guard

```ts
// streams/poller-runtime.ts:43
const timer = setInterval(() => void tick(), intervalMs);
```

`tick()` is async; the interval does not await it. The header comment claims "overlapping passes are safe" — true for alert *de-duplication* (backed by the `@@unique([streamingAccountId, providerStreamId])` constraint), but **each overlapping pass performs the full set of outbound API calls for every channel**. A cycle slower than `intervalMs` multiplies provider traffic linearly.

For YouTube this is a quota DoS: `search.list` costs 100 units against a 10,000/day allowance. The floor is 15s (`instrumentation.ts:26`), so **15s × 100 = 10,000 units — the entire daily allowance, drained in under an hour** at the minimum permitted interval.

**Fix:** an in-flight boolean guard, and raise the floor to 300s for YouTube.

---

### 12. MEDIUM — No security headers

`next.config.ts` has **no `headers()` block**, and repo-wide grep for `Content-Security-Policy`, `X-Frame-Options`, `Strict-Transport-Security` returns **zero matches**.

Missing: CSP, HSTS, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`.

**Fix:** add a `headers()` function to `next.config.ts`.

---

### 13. MEDIUM — Internal error messages rendered to the client

```tsx
// app/error.tsx:38  and  dashboard/error.tsx:46
{error.message ? <p className="font-mono text-xs">{error.message}</p> : null}
```

Server-thrown messages reach the browser. `getServerConfig()` throws an error containing **every missing env var name** (`server-config.ts:54-61`), and Prisma errors like `"Unique constraint failed on the fields: (name)"` leak schema details.

Note: in production Next.js sanitizes errors thrown from Server Components, so exposure depends on runtime and origin. Treat this as defence-in-depth.

**Fix:** log `error.message` server-side (already done in the `useEffect`) and render only a fixed string plus `error.digest`.

---

### 14. MEDIUM — No input bounds in any server action

Zod is used **only** for env validation (`config/server-config.ts:3`). **No server action validates with a schema.** Raw `FormData` is read directly everywhere via `Number.parseInt(String(raw ?? ""), 10)`.

No length bounds on: `moderation.name`, `achievements.name/description/icon`, `challenges.name/description`, `rewards.name/description`, `roles.name`, `alerts.customMessage`.

No ceilings on `threshold` / `xpReward` — `parseInt("1e999")` passes the `<= 0` guard. Contrast `xp/settings.ts:41-99`, which *is* a proper allowlist validator with upper bounds — the good pattern already exists.

Also: `alerts.watchButtonLabel` exceeds Discord's 80-char button limit and **fails the entire alert send**, and `customMessage` is concatenated into `message.content` (`build-alert-message.ts:163`) with no `@everyone`/`@here` scrubbing — a mass-ping primitive for alerts.

**Fix:** add `.max()` bounds, numeric ceilings, and `allowed_mentions: { parse: [] }` on alert sends.

---

### 15. MEDIUM — `NEXT_PUBLIC_APP_URL` fails open

```ts
// config/server-config.ts:26-29
NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
```

The `.default()` **passes validation when unset**. `getDiscordRedirectUri()` then builds `http://localhost:3000/callback` and sends it to Discord as `redirect_uri` on a misconfigured production deploy — silently redirecting the admin's authorization code to localhost.

This is a fail-open default inside an otherwise fail-closed validator. Also, `Twitch`/`Kick`/`YouTube` clients read `process.env` directly (`twitch/client.ts:45`, `kick/client.ts:49`, `youtube/client.ts:51`), bypassing `getServerConfig()` entirely — so their Zod entries are dead code.

**Fix:** make it `.required()` in production; default only when `NODE_ENV === "development"`.

---

### 16. MEDIUM — Data functions skip the codebase's own auth boundary

`get-dashboard-stats.ts:18` documents an explicit policy:

> *"Calls `requireCurrentUser` itself rather than relying on the layout or proxy. Each data function is its own boundary, so a future change to the layout, a matcher, or a new entry point cannot silently expose these counts."*

`getAnalytics()` (`analytics/queries.ts:61`) and `getSetupChecklist()` (`setup-checklist.ts:34`) **do not** follow it — they rely solely on `layout.tsx`.

Current exposure is nil (the layout guards the tree), but this is one matcher change away from leaking member counts and XP totals, and it directly contradicts the project's own stated rule.

---

### 17. MEDIUM — Missing indexes on two hot queries

- `poller.ts:285-289` filters `{ streamingAccountId }` ordered by `startedAt DESC`, **once per channel per cycle**. The only leading-`streamingAccountId` index is the unique on `(streamingAccountId, providerStreamId)`, which doesn't serve the sort. Needs `@@index([streamingAccountId, startedAt])`.
- `analytics/queries.ts:106` filters `{ guildId, createdAt: { gte } }` with **no `source` predicate**, so the existing `@@index([guildId, source, createdAt])` degrades to a prefix scan. Needs `@@index([guildId, createdAt])`.

---

### 18. MEDIUM — No server-side session revocation

The session is a stateless HMAC assertion; `prisma/schema.prisma` has **no `Session` model** (verified: 21 models, none for sessions). This is a deliberate, documented tradeoff (`session-crypto.ts:5-7`), but it has consequences:

- A stolen session token remains valid for the **full 7 days** regardless of logout, password change, or Discord-side token revocation.
- There is no way to force-logout a user, no "sign out everywhere", and no session audit trail.
- Rotating `AUTH_SECRET` is the *only* revocation mechanism — and it logs out every user globally.

**Fix:** add a `Session` table keyed by a random id in the cookie, or (cheaper) shorten the TTL and add a `sessionVersion` column on `User` that invalidates all issued tokens when bumped.

---

### 19. MEDIUM — Discord token never revoked on logout

`logout/route.ts` is 16 lines; `destroySession()` deletes **only the browser cookie**. There is no `POST https://discord.com/oauth2/token/revoke`.

A signed-out user's Discord access token (`identify guilds` — full read of every server they are in) **remains live in the database indefinitely**, and is overwritten on next login rather than revoked.

Compounding: `DiscordAccount.tokenExpiresAt` is **never written and never read** (the column exists and is permanently `NULL`), and `DiscordTokenResponse` declares a `refresh_token` that is never persisted — `DiscordAccount` has no `refreshToken` column at all.

**Fix:** revoke at Discord on logout, clear the stored token, and write `tokenExpiresAt` from `expires_in`.

---

### 20. MEDIUM — `getAuthSecret()` bypasses the 32-char minimum

The length rule lives in the Zod schema (`server-config.ts:20`):

```ts
AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),
```

But **the signing path never calls `getServerConfig()`**. `createSession` and `getSession` both use:

```ts
// config/server-config.ts:75-78
export function getAuthSecret(): string | null {
  const value = process.env.AUTH_SECRET;
  return value && value.length > 0 ? value : null;   // ← no minimum
}
```

So `AUTH_SECRET=x` is accepted and used **directly as the HMAC key**. This is the one place where weak-secret validation is bypassed on the path that actually matters — the `.env.example` guidance is correct, but nothing enforces it. The login page's readiness check (`login/page.tsx:52`) compounds it by using the same lenient getter.

**Fix:** apply `.min(32)` inside `getAuthSecret()`.

---

### 21. MEDIUM — No rate limiting on any auth endpoint

Repo-wide grep for `rateLimit|limiter|throttle` returns hits only in **Discord message/join moderation**. Nothing protects HTTP endpoints:

- `GET /api/auth/login` — unauthenticated; mints a fresh 32-byte state + cookie per hit.
- `GET /callback` — unauthenticated, and **each hit makes up to 3 outbound Discord API calls** (`callback/route.ts:57-61`). This is a free amplification vector against both your app and Discord's rate limits — sustained abuse would degrade your own legitimate logins.
- `GET /api/internal/poll-streams` — secret-guarded but unthrottled; each accepted call runs a full poll cycle.
- `POST /logout` — unauthenticated.

---

### 22. LOW — No PKCE

`buildDiscordAuthorizeUrl` (`discord-oauth.ts:57-69`) sends no `code_challenge`; `exchangeCodeForToken` (`:80-86`) sends no `code_verifier`. Risk is mitigated because the client secret is server-side and `redirect_uri` is entirely server-derived — but PKCE is the OAuth 2.1 baseline and Discord supports it.

---

### 23. LOW — `STREAM_POLL_SECRET` has no entropy floor

Read raw at `poll-streams/route.ts:33` and **absent from the Zod schema** entirely. An operator setting `STREAM_POLL_SECRET=x` gets a one-character secret with no warning anywhere.

---

### 24. LOW — Dead `isGuildAdmin` column

`schema.prisma:187` defines `isGuildAdmin Boolean`. It is written at `callback/route.ts:70` and **never read anywhere** (verified by grep — the `isGuildAdmin` hits in `bot/permissions.ts` are a *different function* with the same name). It is an authorization snapshot that will silently drift and invites future misuse. Either use it or drop it.

---

### 25. LOW — `logout` redirect derives origin from the `Host` header

```ts
redirect(new URL("/", request.url).toString());
```

`request.url` is reconstructed from the incoming `Host` header, so a proxy that doesn't pin `Host` could yield `Location: http://evil.com/`. Low severity — POST-only and `SameSite=Lax` blocks the cross-site POST — but it's a Host-header-injection sink. Use `redirect("/")`.

---

### 26. LOW — Cookies lack the `__Host-` prefix

`SESSION_COOKIE_NAME = "komu_session"` (`session.ts:24`) and the OAuth state cookie are host-only by omission (no `domain` attribute), which is correct. A `__Host-` prefix would make host-only + `Secure` + `Path=/` **enforced by the browser** rather than by convention, closing sibling-subdomain cookie tossing.

---

### 27. LOW — Dev-dependency advisories

`npm audit` reports **3 high, 0 critical**, all on the Prisma CLI path:
`deepmerge-ts` → `@prisma/config` → `prisma`. The issue is stack exhaustion
when merging a recursive object graph, which requires a crafted
`prisma.config.ts` supplied by the person running the CLI. It is not reachable
from the running application.

**Fixed:** zod 4.6.5 → 4.6.7 closed the oversized-collection memory advisory,
and an npm `overrides` entry moved undici 6.29.0 → 6.29.1 (used by
discord.js) past the EventSource and content-encoding advisories.

**Remaining:** the Prisma advisory is only fixed in Prisma 7, which is a major
migration to driver adapters. Deferred deliberately: the CLI is a development
tool, the trigger is not attacker-controlled, and the migration is larger than
the risk. Revisit when Prisma 7 is adopted for other reasons.

---

## What is already done well

Do not regress these — they are genuinely good:

- **Zero raw SQL in the entire project.** No `$queryRaw`, `$executeRawUnsafe`, or `Prisma.raw`. SQL injection is structurally impossible.
- **No SSRF.** All five outbound clients use constant base URLs; user input only reaches `URLSearchParams` or `encodeURIComponent`. Twitch additionally regex-validates identifiers at the adapter boundary (`LOGIN_PATTERN = /^[a-z0-9_]{4,25}$/`).
- **Session crypto is correct.** HMAC-SHA256, `timingSafeEqual` with a length pre-check, payload shape validation before use, 7-day TTL, `httpOnly` + `SameSite=Lax` + `secure` in prod.
- **OAuth `state` is correct.** `randomBytes(32)`, httpOnly single-use cookie cleared *before* validation, constant-time compare. PKCE (S256) was added on top: the verifier lives only in that cookie, so an intercepted code cannot be exchanged.
- **Open redirect defended twice** — sanitised at write (`login/route.ts:61-69`, including both `//` and `/\`) and re-validated on read (`callback/route.ts:135-137`).
- **Bot permission model is solid.** Every mutating command routes through one fail-closed helper reading live Discord permissions, with unit tests including the null case. Role-hierarchy checks correctly refuse to act on the bot itself or the owner.
- **ReDoS-safe word filter** via `escapeRegExp` plus an empty-needle guard.
- **No secrets in logs** anywhere, with explicit comments explaining *why* bodies are withheld (`discord-oauth.ts:90-92` deliberately logs only `status` to avoid leaking the client secret).
- **Fail-closed defaults** where it counts: `proxy.ts` documents itself as a convenience, not the boundary; the poll endpoint returns 503 when unconfigured; `getSession()` returns `null` rather than trusting an unverifiable token.
- **The proxy's "fails open" shape is genuinely safe here**, because the compensating controls exist. `looksLikeSessionToken("a.b")` passes, but I verified all 8 Server Action files and every dashboard data panel independently call `requireCurrentUser()` *in the data-access path* — which matters, because App Router layouts and pages render concurrently, so a layout-only check would not gate page data.
- **The session token's `userId` claim is never trusted**; the authoritative ID is re-read from the DB via `discordId` (`current-user.ts:30-38`), removing a class of claim-confusion bugs.
- **Signature is verified before `JSON.parse`** (`session-crypto.ts:68` before `:72`), so untrusted bytes are never parsed.
- **Discord permission checks are uncached**, so admin revocation in Discord takes effect on the next request — the correct trade-off for an authorization decision.
- **IDOR defence via scoping** — deletes use `deleteMany({ id, guildId })`, not bare `delete`.
- **Channel/role IDs validated against the live Discord API** before persisting, with `@everyone` rejected, consistently across 6 files.
- **Attendance, achievements and challenges idempotency is correct** — unique constraints plus `skipDuplicates` and row-count gating. These are the templates for fixing finding 3.

---

## Remediation roadmap

### Do today (~1 hour) — closes the critical holes

1. Add `canAccessPrimaryGuild(user.userId)` to all 8 `requireGuild()` helpers **and** `dashboard/layout.tsx`. *Closes finding 1.*
2. Guard the `if (existing)` branch in `setup/actions.ts` with `verifyGuildAccess` against `existing.discordId`. *Closes finding 2.*

These two are the entire critical surface.

### This week (~1 day)

3. Add `@@unique([rewardId, memberId])` + migrate; switch `grant.ts` to `createMany({ skipDuplicates: true })`. *Finding 3.*
4. Make `awardXp` serializable, or use `FOR UPDATE`. *Finding 4.*
5. Move the XP cooldown check+stamp into one conditional `updateMany`. *Finding 5.*
6. Encrypt Discord tokens at rest with AES-256-GCM. *Finding 6.*
7. Poll endpoint → `POST`, header-only secret, ≥32-char floor, rate-limit failures. *Finding 7.*
8. Gate bot `/setup` on `isGuildAdmin`. *Finding 8.*
9. Add `guildId` to the `GuildMember` lookup in `moderate.ts`. *Finding 9.*

### This sprint

10. Security headers in `next.config.ts` (CSP, HSTS, `X-Frame-Options`, `nosniff`, `Referrer-Policy`). *Finding 12.*
11. Stop rendering `error.message` in both error boundaries. *Finding 13.*
12. `AbortSignal.timeout()` on all 9 fetches; add the poller in-flight guard; raise the interval floor to 300s. *Findings 10, 11.*
13. Zod schemas per server action with `.max()` bounds and numeric ceilings; `allowed_mentions: { parse: [] }` on alert sends. *Finding 14.*
14. Add the missing DB indexes. *Finding 17.*
15. Add `requireCurrentUser` to `getAnalytics` and `getSetupChecklist`. *Finding 16.*
16. Rate-limit `/api/auth/login` and `/callback`; note `/callback` makes 3 outbound Discord calls per hit. *Findings 21, 18.*
17. Revoke the Discord token on logout and write `tokenExpiresAt`. *Finding 19.*
18. Enforce `.min(32)` inside `getAuthSecret()`. *Finding 20 — one line.*
19. Clear `NEXT_PUBLIC_APP_URL` default in production. *Finding 15.*
20. `npm audit fix` for the dev-only advisories. *Finding 27.*

### Hardening backlog

- Add a `Session` table (or a `sessionVersion` bump column on `User`) so logout actually revokes. *Finding 18.*
- Add PKCE to the OAuth flow. *Finding 22.*
- Prefix cookies with `__Host-`. *Finding 26.*
- Add a `SENSITIVE_KEYS` redaction pass in `logger.ts` so secret-safety is structural rather than per-call-site.
- Add an origin assertion (`new URL(path, BASE).origin === BASE_ORIGIN`) in the provider clients so SSRF-safety is structural, not an implicit invariant.
- Drop or actually use the dead `isGuildAdmin` column. *Finding 24.*
- Change `logout/route.ts` to `redirect("/")` to remove the `Host`-header sink. *Finding 25.*
- Consider `next-auth` or a dedicated CSRF token if non-Action mutating routes grow.
- Rate-limit `sendTestAlertAction` independently of authorization.

---

## Appendix — coverage

**Read in full:** all 8 `dashboard/*/actions.ts` + 8 `page.tsx`, `setup/{actions,page,GuildPicker}`, all `(auth)` routes and `api/**`, `proxy.ts`, `instrumentation.ts`, `next.config.ts`, `eslint.config.mjs`, `prisma.config.ts`, `prisma/schema.prisma`, `.env.example`, `.gitignore`, `README.md` security notes, PRD §11 — **and** all of `src/lib/**` (auth, bot, streams, twitch, youtube, kick, discord, xp, moderation, rewards, roles, challenges, achievements, attendance, analytics, leaderboards, levels, config, logger, db) and `src/components/**`.

**Checks performed:** `npm audit --json`; repo-wide greps for raw SQL, `dangerouslySetInnerHTML`, `eval`, `Math.random` in token paths, `$queryRaw`, `NEXT_PUBLIC_*`, security headers, `AbortController`; `git log` and `git ls-files` for committed secrets; `canAccessPrimaryGuild` call-site verification.

**Secret hygiene confirmed:** `.env.local` is gitignored (`.gitignore:34-35`), `.env.example` holds only empty placeholders, and `git ls-files` shows **no** `.env`, `.env.local`, `.pem`, or `.key` file has ever been committed. No hardcoded secrets anywhere in `src/` or `prisma/`.

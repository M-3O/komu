# KOMU TikTok integration: research and architecture

**Status:** planning only. No TikTok provider, migration, production behavior, deployment, CranL configuration, or worker-monitoring-transport change is included in this document.

**Branch:** `feat/tiktok-integration`

**Research snapshot:** 2026-11-10

## Executive recommendation

Proceed with an official TikTok OAuth connection and an optional official video-notification feature. Do not claim or enable TikTok LIVE alerts yet.

As of this research snapshot, TikTok's public developer documentation lists Login Kit, Display API, Content Posting API, Research API, Data Portability API, and related products, but no public LIVE-status, LIVE-event, or LIVE webhook product. The published scopes reference also contains no LIVE scope. TikTok's Data Portability documentation mentions historical “Go LIVE History,” but that is an export/archive capability, not a real-time detection source.

Therefore:

- **Supported direction:** official OAuth account linking, profile identity, and optional new-video notifications, subject to TikTok app review and scope approval.
- **Not currently supported:** official TikTok LIVE start notifications, LIVE status polling, LIVE chat/gift/viewer events, or a fabricated “live” state derived from a profile/video endpoint.
- **Not approved for KOMU:** direct scraping/reverse-engineered LIVE clients or a third-party LIVE relay. They may be evaluated later behind explicit legal, policy, security, reliability, and cost approval, but must not be introduced into production from this branch.

## What the existing KOMU architecture already gives us

The current provider-neutral design is a good fit for a future approved TikTok source:

- `src/lib/streams/types.ts` defines `StreamingProviderAdapter`, `ProviderAccount`, and `StreamInfo`.
- `src/lib/streams/registry.ts` is the single provider lookup and availability boundary.
- `src/lib/streams/connect-account.ts` resolves an external identity before persisting it.
- `src/lib/streams/poller.ts` already separates provider reads from Discord delivery, records a session before sending, and relies on the unique `(streamingAccountId, providerStreamId)` constraint for duplicate prevention.
- `src/lib/streams/decide-alert.ts` distinguishes a new provider session from an already-announced session.
- `src/lib/streams/build-alert-message.ts` already supports custom text, embeds, thumbnails, viewer/category fields, watch buttons, and an allow-listed role mention.
- `src/app/dashboard/streams/ChannelManager.tsx` and `src/app/dashboard/streams/actions.ts` are the reusable connection/status UI and server-action boundary.
- `src/app/dashboard/alerts/*` already contains provider-neutral routing and preview UI.
- `src/lib/dashboard/require-guild.ts` is the owner/admin authorization boundary that must guard every future TikTok mutation.
- `src/lib/auth/token-crypto.ts` provides authenticated encryption at rest, but its current comments and naming are Discord-specific; a future provider-token helper should make the same guarantee without exposing tokens to the browser.

The main architectural gap is that the current model assumes every connected provider can answer `getLiveStream()`. TikTok should not be added to `availableProviders()` until a real, approved live source exists. The dashboard must distinguish “TikTok account/video features available” from “TikTok LIVE alerts available.”

## First-party TikTok feasibility

### Account linking: feasible

Use TikTok Login Kit for Web with a server-owned OAuth callback. The official web flow requires a registered absolute HTTPS redirect URI with no query parameters or fragment, and the authorization request carries `client_key`, `scope`, `redirect_uri`, `state`, and `response_type=code`.

The flow should use:

- a short-lived, single-use state record bound to the current KOMU owner, guild, redirect destination, and requested capability;
- PKCE where supported by the selected web token flow;
- server-side code exchange;
- encrypted server-side access and refresh tokens;
- refresh-before-expiry and reauthorization handling;
- no TikTok password, session cookie, or account credential collection.

For the minimum linked identity request `user.info.basic` is sufficient for `open_id`, avatar, and display name. Add `user.info.profile` only if KOMU needs the official username and profile deep link. TikTok users may grant only a subset of requested scopes, so the callback must verify the granted scope set before completing the connection.

The stable application-scoped identity should be TikTok `open_id`; the username is display metadata and may change. The official user-info response documents `username` and `profile_deep_link` under `user.info.profile`.

### New-video notifications: feasible, but separate from LIVE

With the user's consent to `video.list`, KOMU can call `POST /v2/video/list/` to read the user's public videos, sorted by creation time. The API returns video IDs, creation time and share metadata through the Display API. `video.query` can refresh metadata such as the cover image and share link.

This should be modeled as a video feed, not as a `Stream` row:

- store a per-account cursor or last-seen TikTok video ID/time;
- deduplicate on `(streamingAccountId, providerVideoId)`;
- notify only after the video is confirmed as new;
- treat the cover image URL as temporary because TikTok documents a six-hour TTL;
- on HTTP 429, honor backoff and do not advance the cursor;
- on token/scope failure, mark the connection as needing reauthorization rather than treating the account as empty.

The current `Stream` table should not be reused for videos. A future migration should add a small TikTok video/notification record or a provider-neutral external-content record. No migration is authorized in this phase.

### LIVE start notifications: not feasible through the documented public API

The official scopes reference contains user/profile/statistics, video, portability, research, and posting scopes, but no LIVE-status or LIVE-event scope. The official product index likewise has no public LIVE API product. The historical LIVE material in Data Portability is a user-data export and cannot provide a timely offline-to-live transition for Discord alerts.

Do not infer “live” from:

- a new video appearing;
- a profile page or guessed `/live` URL;
- a missing/empty Display API response;
- Data Portability history;
- an unofficial endpoint unless separately approved.

An unavailable capability must render as unavailable or “not connected,” never as offline and never as live.

## Third-party LIVE options

These are research candidates only. None is approved for production use by this plan.

| Option | Technical fit | Reliability / operations | Licensing and policy risk | Recommendation |
| --- | --- | --- | --- | --- |
| `tiktok-live-connector` for Node.js | Fits the repository language and exposes room info, `fetchIsLive`, Webcast events and a WebSocket client. | Reverse-engineered internal Webcast protocol; the project documents that TikTok can break it. A prior TikTok change made versions before 1.1.7 stop working. A long-lived connection or a separate live check is needed per account. | The published npm metadata for the current 2.x package reports AGPL-3.0-only, while the GitHub `main` package/license pages currently show MIT. That provenance mismatch needs legal review. It is not an official TikTok API and can conflict with TikTok's anti-scraping/reverse-engineering restrictions. | Do not add to KOMU. At most, evaluate in an isolated, non-production spike after approvals. |
| `TikTokLive` for Python | Rich event model and a mature ecosystem; can run as a sidecar if KOMU ever needs event ingestion. | Requires a Python process and persistent WebSocket lifecycle. Its own README calls it an unofficial reverse-engineering project and says not to treat it as a production SLA. | Modified AGPL license; the project explicitly says it is unaffiliated with TikTok. It is a poor fit for the current Next.js monolith and has the same platform-policy exposure. | Do not add to KOMU. |
| Euler Stream managed API / LIVE alerts | Most operationally realistic third-party path: WebSocket, bulk live check, and webhook-style LIVE alerts are documented; it handles signing and protocol drift. | Vendor dependency, quotas, plan limits, outage risk, cost, and possible regional/creator coverage differences. Vendor uptime claims are not a KOMU SLA. Webhook delivery would still need signature verification and idempotency. | Still not a TikTok first-party API. Euler's terms restrict raw API exposure, resale, bulk redistribution, and credential sharing; TikTok policy and data-rights review remain necessary. | Candidate only after written product/legal/security approval and a vendor agreement/SLA review. |

The open-source libraries advertise that they can read public LIVE data without TikTok login credentials. That does not make them authorized or suitable for KOMU. KOMU must never accept `sessionid`, `tt-target-idc`, passwords, or other TikTok account secrets from creators; the connector documentation's authenticated-chat paths are explicitly out of scope.

TikTok's own Terms of Service prohibit automated scraping/crawling/extraction except with written approval, and the Developer Terms limit automated interaction to the documented Developer Services and prohibit reverse engineering, excessive/abusive use, and bypassing access controls. This is why an unofficial client is a policy risk even when its code is openly licensed.

## Recommended architecture

### Capability-aware provider manifest

Do not make the enum alone determine whether a provider is usable. Introduce a provider capability manifest when implementation begins, for example:

```text
TikTok
├── accountLinking: official OAuth
├── profile: official Display API
├── videoNotifications: official Display API + video.list
├── liveStatus: unavailable
├── liveStartEvents: unavailable
└── engagementEvents: unavailable
```

The manifest should drive:

- which provider cards appear in the connection UI;
- whether the connection action is OAuth or free-text lookup;
- whether a provider is included in a live poller;
- which alert controls are enabled;
- dashboard copy such as “available,” “pending approval,” “unavailable,” or “unknown.”

This also removes the current hard-coded `providers.length / 3` assumption when a provider has partial capability.

### Account-linking boundary

The future flow should be:

```text
Owner dashboard
  → Start TikTok OAuth
  → state + PKCE stored server-side / short-lived cookie
  → TikTok consent
  → callback validates state and code
  → server exchanges code and fetches user.info
  → encrypted tokens + open_id stored for the owner’s guild
  → capability manifest enables profile/video features
```

The callback must not trust a browser-supplied guild or owner ID. Bind the OAuth attempt to the authenticated owner and resolve the guild again through `requireGuild()` before writing.

### LIVE boundary, if TikTok later approves a source

If TikTok publishes an official LIVE API, implement it behind the existing adapter and poller contracts. If the only approved option is a vendor, isolate it behind a small server-side adapter or ingestion service:

```text
TikTok official API or approved vendor
  → bounded client / verified webhook
  → normalized live session
  → idempotent session store
  → existing alert builder + Discord REST
```

Use a provider-returned room/session identifier as `providerStreamId`. Never synthesize one from a timestamp or username. For webhook deliveries, deduplicate the external delivery/event ID before normalizing; for polling, retain the existing unique stream-session constraint.

Future engagement events should not run in a request handler. Use a long-lived sidecar/worker or managed webhook consumer, bounded event processing, Discord rate-limit handling, and an event idempotency ledger. Store only the event data needed for the requested feature; do not persist chat/gift content by default.

## Failure handling and safe polling

The current semantics are the right foundation:

- provider timeout, 429, 5xx, malformed response, or expired token = **unknown/error**, not offline;
- a provider outage must not close an existing live session;
- a new session is recorded before Discord delivery;
- a Discord failure is retried by the existing session state without creating another session;
- the database unique constraint protects overlapping detection passes.

For TikTok video polling or a future approved LIVE source, add:

- per-provider request timeout and cancellation;
- bounded concurrency rather than one unbounded request per account;
- jittered intervals and a per-provider circuit breaker;
- `Retry-After`/429-aware backoff;
- single-flight token refresh per TikTok connection;
- last-success, last-error, and next-eligible-at telemetry;
- explicit reauthorization status for revoked or insufficient scopes;
- no cursor advancement after an incomplete or failed page.

Do not add TikTok to the current fast poller until a supported live endpoint exists. Do not add an unofficial client to `registry.ts`, `instrumentation.ts`, the internal poll route, or production environment configuration as part of this phase.

## Implementation phases after approval

### Phase 0 — decisions and approvals

1. Confirm that the product accepts TikTok video notifications even though LIVE alerts are unavailable.
2. Register a TikTok developer app with Login Kit and Display API, and confirm the required scopes and app-review path.
3. Obtain written confirmation from TikTok or an approved vendor before any LIVE source is selected.
4. Complete legal review of TikTok terms, vendor terms, license compatibility, privacy notice, retention, and data deletion.
5. Decide whether TikTok tokens are stored in the existing encrypted credential pattern or a separate encrypted provider-token model.

### Phase 1 — official OAuth account linking

1. Add a server-only TikTok OAuth client using state, PKCE, static HTTPS redirect URI, and strict callback validation.
2. Add a dashboard “Connect TikTok” action guarded by Owner-Only access.
3. Fetch `user.info.basic` and, if approved/needed, `user.info.profile`.
4. Store the app-scoped `open_id`, username/display name/avatar/profile link, encrypted tokens, expiry, and granted scope set.
5. Add disconnect/revoke/re-auth handling and tests for partial scopes and callback replay.
6. Keep TikTok out of the live provider registry until LIVE capability is actually supported.

### Phase 2 — optional official new-video notifications

1. Request `video.list` only when the creator opts in.
2. Add a separate video cursor/deduplication record; do not reuse `Stream`.
3. Poll at a conservative interval, with bounded concurrency and 429 backoff.
4. Build video-specific Discord copy/embed templates and reuse the existing allow-listed role mention path.
5. Refresh or omit expiring cover URLs; prefer the official share URL for the action button.
6. Add an explicit “Video notifications” toggle separate from live alerts.

### Phase 3 — LIVE source evaluation, no user-facing alerts

Only after written approval:

1. Evaluate the official API or approved vendor in a sandbox/non-production environment.
2. Measure detection latency, false offline/false live results, reconnect behavior, quota/cost, regional coverage, and duplicate delivery rate.
3. Verify source terms, license, data rights, secret handling, and exit strategy.
4. Run a shadow canary that records metrics without posting Discord alerts.

### Phase 4 — LIVE notifications

Only after the canary passes:

1. Add a real `TIKTOK` provider capability and normalized live adapter/ingestion path.
2. Use the provider room/session ID for deduplication.
3. Reuse `buildAlertMessage`, `AlertConfiguration`, Discord role allow-listing, and the existing failure semantics.
4. Add explicit UI status for source outages and reauthorization.
5. Roll out behind an opt-in feature flag and a kill switch.

### Phase 5 — engagement integrations

Only if the selected source provides an approved event stream and the product has a clear use case:

- subscribe only to required events;
- isolate ingestion from the web request path;
- verify webhook signatures or vendor authentication;
- idempotently process gifts/comments/follows/viewer updates;
- apply Discord rate limits and moderation/privacy rules;
- avoid storing raw chat or personal data unless explicitly needed.

## Required approvals before implementation

- **Product:** approve separate wording and UX for official account/video features versus unavailable LIVE alerts.
- **TikTok platform:** approve the developer app, Login Kit, Display API and requested scopes; confirm the redirect URI, privacy policy, terms URL, and review demo.
- **Legal/policy:** approve any use of a third-party LIVE source, its terms, its license, its data rights, and TikTok-policy posture. No unofficial scraper is approved by this plan.
- **Security:** approve encrypted token storage, token scope/retention, revocation and deletion behavior, callback binding, webhook verification, and secret rotation.
- **Operations:** approve monitoring, rate-limit budgets, vendor spend/SLA, fallback behavior, and the deployment/worker shape. This does not authorize CranL changes.
- **Database:** approve a future migration for TikTok connection metadata and separate video notification/deduplication records. Existing migrations and production databases remain untouched.

## Decision log

| Capability | Decision now | Reason |
| --- | --- | --- |
| TikTok OAuth account linking | Plan for implementation | Official Login Kit and Display API support it; secrets can stay server-side. |
| Profile identity | Plan for implementation | `user.info.basic` plus optional `user.info.profile`. |
| New-video notifications | Feasible, optional | Official `video.list`; separate cursor/deduplication model required. |
| LIVE start notifications | **Unavailable** | No public first-party LIVE status/event product or scope found. |
| LIVE chat/gifts/viewer engagement | **Unavailable** | No public first-party event API found; third-party sources are not approved. |
| Direct Webcast scraping | **Rejected for production** | Reverse-engineered, brittle, licensing/policy risk, and violates the requested safety boundary. |
| Managed third-party LIVE relay | **Evaluation only** | Technically plausible, but requires written approvals, contract/SLA, security review, and policy clearance. |
| Custom embeds and role mentions | Reuse existing path | `AlertConfiguration` and `buildAlertMessage` already support them once a supported stream source exists. |
| Duplicate prevention | Reuse existing path | Provider session ID plus database uniqueness and pre-send recording. |

## Sources

- [TikTok Developer Docs](https://developers.tiktok.com/docs/en/welcome)
- [Scopes Reference](https://developers.tiktok.com/docs/en/tiktok-api-scopes)
- [Login Kit Web](https://developers.tiktok.com/docs/en/login-kit-web)
- [Manage User Access Tokens](https://developers.tiktok.com/docs/en/login-kit-manage-user-access-tokens)
- [Get User Info](https://developers.tiktok.com/docs/en/tiktok-api-v2-get-user-info)
- [List Videos](https://developers.tiktok.com/docs/en/tiktok-api-v2-video-list)
- [Video Object](https://developers.tiktok.com/docs/en/tiktok-api-v2-video-object)
- [Rate Limits](https://developers.tiktok.com/docs/en/tiktok-api-v2-rate-limit)
- [Data Portability: Data Types](https://developers.tiktok.com/docs/en/data-portability-data-types)
- [TikTok Developer Terms of Service](https://t.tiktok.com/legal/page/global/tik-tok-developer-terms-of-service/en)
- [TikTok Terms of Service](https://t.tiktok.com/legal/page/us/terms-of-service/en)
- [TikTok-Live-Connector repository](https://github.com/zerodytrash/TikTok-Live-Connector)
- [TikTok-Live-Connector npm package](https://www.npmjs.com/package/tiktok-live-connector)
- [TikTokLive Python repository](https://github.com/isaackogan/TikTokLive)
- [Euler Stream LIVE API docs](https://www.eulerstream.com/docs/api/tiktok-live)
- [Euler Stream LIVE alerts docs](https://www.eulerstream.com/docs/sign-server/live-alerts)
- [Euler Stream Terms](https://www.eulerstream.com/terms)

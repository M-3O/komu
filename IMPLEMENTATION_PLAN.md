# Implementation Plan

## 1. Implementation Strategy

Build the first version as a simple Next.js monolith.

### Stack

```text
Next.js
TypeScript
Next.js App Router
PostgreSQL
Prisma
Discord.js
Discord OAuth
Twitch API
YouTube API
Kick API
```

### Explicitly excluded from V1

```text
Fastify
Microservices
Redis
BullMQ
Event Bus
Workers
Kubernetes
Deployment
Billing
Multi-tenant architecture
```

The code should remain modular inside the monolith so these can be introduced later without rewriting the entire application.

---

# 2. Project Structure

A recommended structure:

```text
src/
├── app/
│   ├── (auth)/
│   │   ├── login/
│   │   └── callback/
│   │
│   ├── dashboard/
│   │   ├── page.tsx
│   │   ├── alerts/
│   │   ├── xp/
│   │   ├── roles/
│   │   ├── leaderboards/
│   │   ├── rewards/
│   │   ├── challenges/
│   │   ├── achievements/
│   │   ├── moderation/
│   │   └── analytics/
│   │
│   └── api/
│       ├── integrations/
│       ├── alerts/
│       ├── xp/
│       ├── rewards/
│       ├── challenges/
│       └── moderation/
│
├── components/
│
├── lib/
│   ├── auth/
│   ├── db/
│   ├── discord/
│   ├── twitch/
│   ├── youtube/
│   ├── kick/
│   ├── streams/
│   ├── xp/
│   ├── levels/
│   ├── roles/
│   ├── rewards/
│   ├── challenges/
│   ├── achievements/
│   ├── moderation/
│   └── analytics/
│
├── bot/
│   ├── index.ts
│   ├── commands/
│   ├── events/
│   └── services/
│
└── prisma/
    └── schema.prisma
```

The exact folder structure can change, but the separation of responsibilities should remain.

---

# 3. Phase 0 — Project Setup

## Tasks

1. Create the Next.js application.
2. Enable TypeScript.
3. Configure ESLint.
4. Add Prisma.
5. Connect PostgreSQL.
6. Add environment variable handling.
7. Add Discord.js.
8. Create the basic dashboard layout.
9. Create basic server-side utility structure.
10. Add a simple logging utility.

## Deliverable

A running Next.js project with:

```text
Next.js
+
Prisma
+
PostgreSQL
+
Discord.js
```

No product features yet.

---

# 4. Phase 1 — Database Foundation

## Goal

Create the minimum database required for the application.

## Initial tables/models

Start with:

```text
User
Guild
GuildMember

DiscordAccount
StreamingAccount

AlertConfiguration

XPTransaction
MemberXP

RoleRule

Reward
RewardGrant

Challenge
ChallengeRequirement
ChallengeProgress

Achievement
MemberAchievement

ModerationRule
ModerationAction

Stream
```

## Important fields

Every model should have:

- ID
- Created timestamp
- Updated timestamp where appropriate

Community-specific records should have:

```text
guildId
```

even though only one server is supported in V1.

## Deliverable

Prisma migrations work and the database can be seeded with a test server.

---

# 5. Phase 2 — Discord OAuth

## Goal

Allow the creator to log into the dashboard.

## Tasks

1. Create Discord OAuth application.
2. Configure OAuth redirect URI.
3. Implement login.
4. Store authenticated Discord user.
5. Retrieve the user's guilds.
6. Identify the configured server.
7. Check administrator/owner permission.
8. Protect dashboard routes.

## Deliverable

User can:

```text
Login with Discord
        ↓
See dashboard
        ↓
See configured server
```

---

# 6. Phase 3 — Discord Bot Foundation

## Goal

Create the bot and connect it to the server.

## Tasks

1. Create Discord bot application.
2. Add required gateway intents.
3. Implement Discord.js client.
4. Connect to Discord.
5. Add basic error logging.
6. Register slash commands.
7. Create `/setup`.
8. Create `/help`.
9. Implement basic send-message helper.
10. Implement role assignment helper.
11. Implement moderation action helpers.

## Deliverable

Bot is online and can:

- Respond to `/help`
- Respond to `/setup`
- Send a test message
- Assign a role

---

# 7. Phase 4 — Streaming Account Integrations

Implement providers one at a time.

Recommended order:

```text
1. Twitch
2. YouTube
3. Kick
```

## Integration design

Create a common internal interface.

Conceptually:

```text
StreamingProvider
├── connectAccount()
├── getAccount()
├── getLiveStream()
├── isLive()
└── normalizeStreamData()
```

Each provider implements this separately.

## Goal

The rest of the application should receive a simple internal stream object rather than provider-specific API responses.

Example:

```text
StreamInfo
├── provider
├── creatorId
├── title
├── game
├── thumbnail
├── viewerCount
├── url
└── startedAt
```

## Deliverable

The application can query each configured provider and determine whether the creator is live.

---

# 8. Phase 5 — Stream Alerts

This is the first major product feature and should be prioritized.

## Tasks

1. Create alert configuration UI.
2. Select Discord channel.
3. Select mention role.
4. Add message customization.
5. Implement live-stream detection.
6. Detect a transition from offline to live.
7. Build Discord embed.
8. Add Watch Now button/link.
9. Mention configured role.
10. Prevent duplicate alerts for the same stream session.
11. Add test-alert functionality.

## V1 detection strategy

Keep this simple.

A scheduled server-side check can query the streaming provider periodically.

For V1, do not introduce Redis, queues, or workers.

Keep the polling mechanism isolated in the integration/stream module so that it can later be replaced by provider webhooks or a proper job system.

## Deliverable

```text
Creator goes live
        ↓
Application detects it
        ↓
Discord alert appears
```

---

# 9. Phase 6 — Discord Activity + XP

## Goal

Create the engagement foundation.

## Tasks

1. Record eligible Discord activity.
2. Create XP transaction service.
3. Add message XP.
4. Add cooldown.
5. Calculate member total XP.
6. Create level calculation.
7. Detect level changes.
8. Store current member level.
9. Add `/level`.
10. Add `/profile`.

## Important implementation rule

Do not only store:

```text
xp = 5000
```

Also record transactions:

```text
XPTransaction
├── member
├── amount
├── source
└── timestamp
```

This gives you history and makes future debugging easier.

## Deliverable

Members can earn XP and level up.

---

# 10. Phase 7 — Automatic Roles

## Goal

Connect engagement progression to Discord roles.

## Tasks

1. Create role-rule database model.
2. Create dashboard configuration page.
3. Add level-based rules.
4. Add membership-age rule.
5. Add watch-time rule only when the required data exists.
6. Check rules after relevant actions.
7. Assign Discord role.
8. Handle missing role/bot permission errors.

## Deliverable

Example:

```text
Level 20
   ↓
Elite role
```

works automatically.

---

# 11. Phase 8 — Leaderboards

## Tasks

1. Create leaderboard queries.
2. Add XP leaderboard.
3. Add activity leaderboard.
4. Add weekly period.
5. Add monthly period.
6. Add all-time period.
7. Add `/leaderboard`.
8. Add dashboard leaderboard page.

## Deliverable

Streamer can view the top community members.

---

# 12. Phase 9 — Rewards

## Goal

Create the reusable condition-to-action system.

For V1, keep the conditions and actions predefined in code.

## Condition types

```text
XP reached
Level reached
Message count
Stream attendance
Watch time
Membership age
```

## Action types

```text
Give XP
Add role
Unlock achievement
Record giveaway entry
```

## Tasks

1. Create reward model.
2. Build reward CRUD.
3. Build reward dashboard.
4. Build reward evaluation service.
5. Build reward grant service.
6. Prevent duplicate grants.
7. Add reward history.
8. Add manual reward option.

## Deliverable

Example:

```text
10 hours watched
        ↓
500 XP
+
VIP role
```

---

# 13. Phase 10 — Challenges

## Goal

Allow creators to create structured community goals.

## V1 challenge types

```text
Attend N streams
Send N messages
Reach level N
Watch N hours
```

## Tasks

1. Create challenge CRUD.
2. Create challenge requirement model.
3. Create progress tracking.
4. Update progress when relevant activity occurs.
5. Detect completion.
6. Grant configured rewards.
7. Display progress in dashboard.
8. Add basic member challenge view.

## Deliverable

Example:

```text
Attend 3 streams
+
Send 20 messages
+
Reach Level 5
        ↓
Challenge Complete
        ↓
Reward
```

---

# 14. Phase 11 — Achievements

## Goal

Add permanent milestones.

## Tasks

1. Create achievement CRUD.
2. Define V1 achievement types.
3. Detect achievement conditions.
4. Store unlocked achievements.
5. Prevent duplicate unlocks.
6. Display achievements on profile.
7. Add `/achievements`.

## Deliverable

Members can unlock and view achievements.

---

# 15. Phase 12 — Moderation

Implement moderation after the engagement system is stable.

## Tasks

### Word filter

- Configurable blocked words
- Message deletion
- Optional warning

### Spam protection

- Message rate detection
- Temporary timeout
- Logging

### Warning system

- Add warning
- View warnings
- Clear warnings

### Anti-raid

- Detect unusual join spikes
- Trigger configurable protection
- Log incident

### Manual moderation

```text
/warn
/timeout
/ban
```

## Deliverable

Moderators can handle common community abuse cases.

---

# 16. Phase 13 — Analytics

Do not build a complicated analytics pipeline.

Use the existing application data.

## Tasks

1. Create analytics queries.
2. Dashboard overview cards.
3. Member growth.
4. Active members.
5. Message activity.
6. XP earned.
7. Stream attendance.
8. Watch time.
9. Rewards granted.
10. Challenge completions.
11. Achievement unlocks.

## V1 approach

Prefer direct PostgreSQL queries and simple aggregates.

Do not introduce:

```text
Analytics warehouse
Kafka
ClickHouse
Redis analytics cache
```

yet.

## Deliverable

A useful overview dashboard without overengineering.

---

# 17. Phase 14 — Dashboard Polish

After the core features work:

## Tasks

1. Improve navigation.
2. Improve empty states.
3. Add loading states.
4. Add error states.
5. Add success notifications.
6. Add confirmation dialogs.
7. Add responsive behavior.
8. Improve configuration UX.
9. Add setup checklist.
10. Add test buttons for important integrations.

## Recommended onboarding

```text
1. Login
2. Connect Discord
3. Connect streaming account
4. Choose alert channel
5. Choose alert role
6. Enable XP
7. Configure roles
8. Done
```

---

# 18. Phase 15 — Testing

Testing should happen throughout the project, not only at the end.

## Unit tests

Prioritize:

- XP calculation
- Level calculation
- Reward conditions
- Challenge progress
- Achievement conditions
- Anti-spam logic
- Stream normalization

## Integration tests

Prioritize:

- Database operations
- Discord role assignment helpers
- Provider API adapters
- OAuth flow
- Alert generation

## Manual tests

Create a test Discord server and verify:

- Bot permissions
- Slash commands
- Stream alerts
- Role assignment
- XP
- Rewards
- Challenges
- Achievements
- Moderation

---

# 19. Recommended Development Order

The safest order is:

```text
1. Project setup
2. Database
3. Discord OAuth
4. Discord bot
5. Twitch integration
6. Stream alerts
7. XP
8. Levels
9. Automatic roles
10. Leaderboards
11. Rewards
12. Challenges
13. Achievements
14. YouTube integration
15. Kick integration
16. Moderation
17. Analytics
18. Dashboard polish
19. Testing/fixes
```

The reason to put Twitch first is to prove the core creator workflow as early as possible:

```text
Creator connects account
        ↓
Creator goes live
        ↓
Discord gets alert
        ↓
Community participates
        ↓
Members earn XP
        ↓
Members level up
        ↓
Members get rewards
```

Once this loop works, the rest of the product becomes much easier to build.

---

# 20. Development Milestones

## Milestone 1 — Foundation

Complete:

- Next.js
- PostgreSQL
- Prisma
- Discord OAuth
- Discord bot

Result:

```text
User can log in
+
Bot is online
```

## Milestone 2 — Core Stream Workflow

Complete:

- Twitch integration
- Stream detection
- Discord alerts

Result:

```text
Streamer goes live
→ Discord notification
```

## Milestone 3 — Community Engagement

Complete:

- XP
- Levels
- Roles
- Leaderboards

Result:

```text
Community activity
→ Progression
```

## Milestone 4 — Gamification

Complete:

- Rewards
- Challenges
- Achievements

Result:

```text
Progression
→ Goals
→ Rewards
```

## Milestone 5 — Community Management

Complete:

- Moderation
- Analytics

Result:

```text
Engagement
+
Management
+
Insights
```

## Milestone 6 — Additional Providers

Complete:

- YouTube
- Kick

Result:

```text
Multi-platform creator support
```

---

# 21. Coding Principles

Because this project is being built by a beginner developer, consistency is more important than cleverness.

## Prefer simple code

Prefer:

```text
function checkReward(...)
```

over building an abstract framework that handles every possible future case.

## Keep business logic out of UI components

Bad:

```text
React component
→ directly calls Twitch
→ calculates XP
→ modifies database
→ assigns Discord role
```

Better:

```text
React component
→ server action/API
→ service
→ database/integration
```

## Keep integrations isolated

Do not scatter Twitch/YouTube/Kick API calls across the application.

Use:

```text
lib/twitch
lib/youtube
lib/kick
```

and let the rest of the system call those modules.

## Keep Discord operations isolated

Use a Discord service/helper layer for:

```text
sendMessage()
addRole()
removeRole()
timeoutMember()
banMember()
```

This makes the application easier to debug.

---

# 22. Avoid Premature Abstraction

Do not build:

```text
Generic Event Framework
Generic Rules DSL
Generic Plugin System
Microservice Architecture
Job Orchestration Framework
```

unless a real requirement appears.

For V1:

```text
Simple
Readable
Modular
Testable
```

is the target.

---

# 23. Definition of Done for V1

The V1 implementation is complete when a creator can perform the full workflow:

```text
Login
  ↓
Connect Discord
  ↓
Connect Twitch / YouTube / Kick
  ↓
Configure stream alerts
  ↓
Receive live notification
  ↓
Members chat / participate
  ↓
Members gain XP
  ↓
Members level up
  ↓
Members receive roles
  ↓
Members appear on leaderboard
  ↓
Members complete challenges
  ↓
Members unlock achievements
  ↓
Members receive rewards
  ↓
Moderators use moderation tools
  ↓
Creator views analytics
```

## Final architecture for V1

```text
                         Browser
                            │
                            ▼
                    ┌───────────────┐
                    │    Next.js    │
                    │               │
                    │ UI            │
                    │ Auth          │
                    │ API           │
                    │ Server Logic  │
                    │ Integrations  │
                    │ Bot Code      │
                    └───────┬───────┘
                            │
                            ▼
                     ┌─────────────┐
                     │ PostgreSQL  │
                     └─────────────┘

External integrations:
Discord
Twitch
YouTube
Kick
```

This is intentionally small. The goal is to get the product working first and only introduce Fastify, Redis, queues, workers, or service separation when the actual product demonstrates that they are necessary.

# Product Requirements Document (PRD)

## Product Name

Streamer Community Bot

## Document Status

Draft — V1

## 1. Product Overview

Streamer Community Bot is a Discord bot with a web dashboard for streamers, YouTubers, and Discord community owners.

The product turns a Discord server into an automated community by connecting Discord with Twitch, YouTube, and Kick and providing community engagement, rewards, achievements, and moderation tools.

### Core idea

> Connect the creator's streaming platforms to Discord and automate community engagement around streams, activity, and rewards.

## 2. V1 Architecture Decision

V1 will be intentionally simple.

### Architecture

- Next.js monolith
- Next.js App Router for the dashboard and server-side application logic
- PostgreSQL for persistent data
- Prisma ORM
- Discord.js for the Discord bot
- Twitch, YouTube, and Kick integrations
- One Discord server (one tenant) for V1
- No microservices
- No event-driven architecture
- No Redis
- No BullMQ
- No dedicated workers
- No deployment/infrastructure work in the initial implementation

The codebase should still be modular internally so that components can be extracted later if the product grows.

## 3. Goals

### Primary goals

1. Allow a streamer to connect a Discord server to the dashboard.
2. Allow the streamer to connect Twitch, YouTube, and/or Kick.
3. Automatically detect when the creator starts a stream.
4. Send a configurable stream alert to Discord.
5. Track Discord member activity and award XP.
6. Support levels and automatic Discord roles.
7. Support leaderboards.
8. Support configurable rewards.
9. Support challenges and achievements.
10. Provide basic moderation tools.
11. Provide basic community analytics.
12. Keep the first implementation simple enough for a beginner developer to understand and maintain.

### Secondary goals

- Establish clean module boundaries.
- Create a database structure that can later support multiple servers.
- Avoid premature infrastructure complexity.
- Make the dashboard easy to extend.

## 4. Non-Goals for V1

The following are explicitly out of scope:

- Multiple Discord servers / full multi-tenant support
- Mobile application
- Public developer API
- Microservices
- Event buses
- Redis
- BullMQ
- Background worker infrastructure
- Kubernetes
- Production deployment automation
- Advanced observability infrastructure
- Billing/subscriptions/payments
- Complex reward fulfillment integrations
- Advanced AI moderation
- Native streaming functionality
- Building a separate streaming platform

## 5. Target Users

### Primary user

A streamer, YouTuber, or creator who owns or manages a Discord community.

### Secondary users

- Community moderators
- Active Discord members
- Stream viewers
- Community participants

## 6. Product Experience

The main user journey should be:

```text
Login with Discord
        ↓
Select/confirm the Discord server
        ↓
Connect Twitch / YouTube / Kick
        ↓
Configure stream alerts
        ↓
Configure XP and roles
        ↓
Configure rewards/challenges/achievements
        ↓
Configure moderation
        ↓
View analytics
```

Community members mainly interact through Discord. The creator or administrator primarily configures the system through the web dashboard.

# 7. Functional Requirements

## 7.1 Authentication

### Requirements

- Users can sign in to the dashboard with Discord OAuth.
- The application retrieves the user's Discord identity.
- The application checks whether the user has sufficient permission to manage the configured server.
- V1 only supports one configured Discord server.

### Acceptance criteria

- A user can log in successfully with Discord.
- Unauthorized users cannot access server configuration.
- The authenticated Discord user is stored/reused by the application.

## 7.2 Discord Bot

The Discord bot is responsible for Discord-specific actions.

### Requirements

- Connect to Discord using Discord.js.
- Register slash commands.
- Receive relevant Discord events.
- Send messages and embeds.
- Mention configured roles.
- Assign and remove roles.
- Apply moderation actions.
- Read member/message activity required by the product.

### Acceptance criteria

- Bot can join the configured server.
- Bot can send a test message.
- Bot can assign a configured role.
- Bot can execute supported moderation actions.
- Required permissions are documented.

## 7.3 Stream Integrations

Supported providers:

- Twitch
- YouTube
- Kick

Each provider should expose a consistent internal interface to the rest of the application.

### Required normalized stream information

- Provider
- Creator/account identifier
- Live status
- Stream URL
- Stream title
- Game/category when available
- Thumbnail/image when available
- Viewer count when available
- Start time when available

The application should not let the rest of the product depend directly on provider-specific response formats.

## 7.4 Stream Alerts

### Requirements

When the connected creator goes live:

- Detect the live stream.
- Build an alert message.
- Send the alert to the configured Discord channel.
- Include available stream information.
- Include a Watch Now button/link.
- Mention an optional configured Discord role.

### Dashboard configuration

The creator can configure:

- Enabled/disabled
- Discord alert channel
- Mention role
- Message title/content
- Embed settings
- Watch Now link behavior
- Provider-specific enable/disable settings

### Acceptance criteria

- A live stream can produce a Discord alert.
- The alert contains the correct stream URL.
- The alert is sent only once for the same live session.
- The configured channel and role are used.

## 7.5 XP and Levels

### XP sources

V1 should support:

- Discord message activity
- Stream attendance/watch-related activity where technically available
- Challenge completion
- Optional manual/admin XP

XP should be recorded as transactions rather than only as a single total.

### Requirements

- Each community member has XP within the server.
- XP can increase based on configured actions.
- Members have levels based on XP.
- The dashboard can configure basic XP settings.
- Level thresholds are configurable or defined by a simple V1 rule set.
- The bot can assign a Discord role when a member reaches a configured level.

### Abuse prevention

V1 should include simple protections such as:

- Message XP cooldown
- Ignoring repeated/spammy messages for XP
- Basic per-member limits where necessary

Do not build an advanced anti-abuse system for V1.

## 7.6 Automatic Roles

The system should allow role assignment based on simple conditions.

### Example conditions

- Level reached
- Membership age
- Support status when supported by the integration
- Watch time threshold where data is available

### Example

```text
Level 20 → Elite role
30 days in server → OG role
10 hours watched → VIP role
```

### Acceptance criteria

- Rules can be configured.
- Eligible members receive the configured role.
- The system does not repeatedly add the same role.
- The bot handles missing permissions gracefully.

## 7.7 Leaderboards

### Leaderboard types

- Weekly
- Monthly
- All-time

### Ranking metrics

- XP
- Activity
- Watch time where available
- Support metric where available

### Requirements

- Dashboard can display leaderboards.
- Discord command can display basic leaderboard information.
- Rankings are scoped to the configured server.

## 7.8 Rewards

Rewards use a simple:

```text
Condition → Action
```

model.

### Example

```text
Watch 10 hours
→ Add VIP role
→ Give 500 XP
```

```text
Reach Level 25
→ Add Elite role
```

### Reward actions for V1

- Give XP
- Add Discord role
- Remove Discord role if needed
- Unlock achievement
- Add challenge/giveaway entry state
- Record a manual reward

### Requirements

- Creator can create, edit, enable, and disable rewards.
- System can evaluate the condition.
- System can grant the action.
- Reward grants are recorded to prevent duplicate grants where appropriate.

## 7.9 Challenges

### Challenge examples

- Attend 3 streams
- Send 20 qualifying messages
- Reach level 5

### Requirements

- Creator can create a challenge.
- Challenge has one or more requirements.
- Challenge has a completion condition.
- Challenge can grant XP and/or other supported rewards.
- Member progress is visible.

### V1 simplicity rule

Keep challenge types predefined. Do not build a fully generic visual rules builder yet.

Supported V1 challenge types may include:

- Message count
- Stream attendance count
- Watch time
- Level reached

## 7.10 Achievements

### Example achievements

- First Stream
- 10 Streams Attended
- 100 Hours Watched
- 1,000 Messages
- OG Member
- Level 25

### Requirements

- Achievements have a name, description, icon, and requirement.
- The system detects when an achievement is unlocked.
- Unlocked achievements are stored.
- Dashboard can display member achievement data.
- Members can view their achievements through a Discord command and/or dashboard.

As with challenges, V1 should use predefined achievement types rather than a completely custom rule builder.

## 7.11 Moderation

### Features

- Anti-spam
- Basic anti-raid protection
- Word filter
- Warnings
- Timeout
- Ban
- Moderation logs

### Requirements

- Moderation settings are configurable from the dashboard.
- Moderators can use supported Discord commands.
- Actions are logged.
- Dangerous configuration changes are permission-protected.

### V1 anti-raid scope

Implement a basic join-spike detection approach rather than a sophisticated threat intelligence system.

## 7.12 Analytics

### V1 metrics

- Total members
- New members
- Active members
- Message activity
- XP earned
- Watch time where available
- Stream attendance where available
- Rewards granted
- Challenge completions
- Achievement unlocks

### Requirements

- Dashboard has an overview page.
- Analytics can be filtered by a basic date range where practical.
- Metrics are based on stored application data.
- V1 does not require a separate analytics warehouse.

## 8. Dashboard Requirements

### Main navigation

```text
Dashboard
├── Overview
├── Stream Alerts
├── XP & Levels
├── Roles
├── Leaderboards
├── Rewards
├── Challenges
├── Achievements
├── Moderation
└── Analytics
```

### Design direction

- Dark modern creator/gaming aesthetic
- Clear navigation
- Minimal setup friction
- Strong visual hierarchy
- Responsive layout
- Avoid unnecessary configuration complexity

## 9. Discord Commands

The exact command list may evolve, but V1 should include simple commands such as:

```text
/help
/setup
/profile
/level
/leaderboard
/achievements
/rewards
```

Moderator/admin commands may include:

```text
/warn
/timeout
/ban
```

Commands that expose admin functionality must verify Discord permissions.

## 10. Data Model

The initial database should include at minimum:

```text
User
Guild
GuildMember

DiscordAccount
StreamingAccount

Stream
StreamSession / StreamRecord

XPTransaction
MemberXP / Level

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

AlertConfiguration

AnalyticsRecord
```

### Important rule

Even though V1 supports only one server, include `guildId` on community-owned records where reasonable. This keeps the design ready for future multi-server support without implementing full multi-tenancy now.

## 11. Security Requirements

- Never expose Discord bot tokens or provider secrets to the browser.
- Keep OAuth client secrets server-side.
- Validate Discord permissions server-side.
- Validate all incoming dashboard mutations server-side.
- Sanitize user-generated content before rendering where applicable.
- Do not trust IDs sent from the frontend without validation.
- Use least-privilege permissions for the Discord bot.

## 12. Error Handling

The application should fail gracefully.

Examples:

- Provider API unavailable
- Invalid OAuth token
- Discord role cannot be assigned
- Missing bot permissions
- Configured channel deleted
- Stream data temporarily unavailable
- Duplicate alert
- Missing thumbnail

Errors should be logged and shown as useful user-facing messages when appropriate.

## 13. Observability for V1

Keep this simple.

Required:

- Server logs
- Bot logs
- Error logs
- Useful context such as guild ID, command/action, and provider

Not required:

- Distributed tracing
- Dedicated log aggregation platform
- Advanced monitoring stack

## 14. Performance Requirements

V1 performance targets:

- Dashboard pages should feel responsive under normal usage.
- Database queries should be indexed for frequently used fields.
- Do not perform expensive calculations on every page request when simple stored values can be used.
- Discord actions should not block unrelated dashboard requests.
- Avoid unnecessary provider API calls.

## 15. Future Architecture Direction

Do not implement these now, but keep code boundaries clean enough to support them later:

```text
Current:
Next.js Monolith
       ↓
PostgreSQL

Future option:
Next.js
   ↓
Backend API
   ├── Discord Bot Service
   ├── Integration Service
   ├── Worker/Queue System
   └── PostgreSQL/Redis
```

Potential future additions:

- Multiple Discord servers
- Redis
- Background jobs
- Queue system
- Dedicated Fastify backend
- More streaming platforms
- Public API
- Billing
- Advanced analytics
- Advanced moderation
- Reward integrations

## 16. MVP Success Criteria

V1 is successful when a streamer can:

1. Log in with Discord.
2. Connect their Discord server.
3. Connect Twitch, YouTube, or Kick.
4. Configure a stream alert.
5. Start a stream and receive the alert in Discord.
6. Enable XP for community activity.
7. Automatically level members.
8. Automatically assign configured roles.
9. View a leaderboard.
10. Create a reward.
11. Create a challenge.
12. Unlock achievements.
13. Enable basic moderation.
14. View basic community analytics.

## 17. Product Principle

Build the smallest system that proves the core value:

> **When the creator streams, the Discord community reacts automatically, stays engaged, and gets rewarded for participating.**

Avoid building infrastructure before the product needs it.

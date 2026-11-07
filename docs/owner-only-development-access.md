# Owner-only development access

The dashboard is restricted to the recorded installation owner until Phases 1C,
1D, 1E and security hardening are complete. This policy applies in all NODE_ENV
modes. It has no runtime opt-out, new secret, schema change or migration.

## Authorization and compatibility

The server-only installation-owner helper reads at most two guilds using the
existing Prisma client. Exactly one guild must exist, with a recorded owner and
an existing linked Discord account. Both user and Discord identity must match
for an authenticated request; OAuth uses Discord's freshly verified identity.
The check is fresh on every use and selects no tokens or profile information.
Errors return fixed categories, never raw connection/provider errors.

requireCurrentUser enforces this after signed-session, account binding and
sessionVersion validation. Existing unauthorized cookies stop working without
a session-table migration. Dashboard readers, the streamed header, setup and
all dashboard Server Actions already use that path. The existing guild and
resource checks remain. Layout/Proxy/UI checks are not the security boundary.

OAuth keeps state, PKCE, encrypted token persistence and cookie protections. It
checks ownership before persistence and updates only the existing linked owner
account; it never creates a user/account. Refused callbacks clear this browser's
session and return a generic login error. Logout is still available to accounts
that no longer qualify for dashboard access.

Setup retains live Discord permissions for a requested server, cannot create an
installation, and never assigns ownerId. Its atomic update matches the verified
installation ID, owner ID and original Discord guild ID. A concurrent change
causes refusal instead of overwriting ownership/configuration.

The bot, payout/announcement delivery, health endpoints and secret-authenticated
internal polling/status APIs are unchanged. The public landing/login pages stay
public. There are currently no separate dashboard-data REST APIs; future ones
must independently call the same owner guard before returning data or writing.

## MANDATORY operator verification before deployment

Do not deploy until an authorized operator independently confirms the stored
owner is the intended person. ownerId records the dashboard user who completed
setup; it is not Discord's guild-owner flag. The earlier setup flow could
replace ownerId, so a populated field alone is not sufficient evidence.

1. Independently obtain the intended installation server ID and the intended
   owner's Discord user ID from Discord, not from the database being checked.
   Use account identity, not display name, roles or Administrator permission.
2. In the trusted Neon console, explicitly select the independently confirmed
   PRODUCTION project/branch, neondb database and public schema. Verify the
   displayed connection endpoint against the approved production inventory.
   Do not copy a test-branch connection or use a fallback DATABASE_URL.
3. Open docs/verify-installation-owner.sql below in the SQL Editor. Replace
   only its two REPLACE_WITH placeholders with those independently obtained
   numeric IDs. Keep these inputs in the operator's private session; do not
   share SQL input/history/screenshots containing account identifiers.
4. Execute the complete read-only transaction. Its only data result is one
   PASS or FAIL value. It selects no names, tokens, credentials or URLs.
   Transaction command statuses carry no account data. No app, bot, migration,
   write or ownership assignment is involved.
5. PASS requires exactly one configured guild, a non-null owner, the expected
   guild ID, the expected linked Discord account, and valid matching User and
   DiscordAccount relationships. Any additional guild (same or different owner)
   fails. Existing unrelated login accounts are allowed: they do not constitute
   installation ownership and this change does not delete them.
6. Treat FAIL, any SQL error, missing result, wrong database/branch/schema,
   unexpected object/history or uncertain identity as a deployment blocker.
   ROLLBACK/end the transaction on error. Do not repair/claim ownership, seed
   data or choose the first login as part of this procedure. Investigate under
   separate authorization. Report only PASS/FAIL, timestamp and reviewed
   revision; never publish the substituted IDs or account information.

This procedure is prepared for the operator. It has NOT been executed against
Production, TEST or any other database by this change. A historical PASS is not
approval for a different endpoint or later ownership state: rerun immediately
before the approved release and confirm the release still targets that branch.

## Regression verification and operational limits

Unit tests inject owner/non-owner sessions and database/provider failures. They
exercise the real common guard, dashboard readers, direct Server Actions,
setup's conditional write and the OAuth route without a database or live login.
Existing bot/health/internal API/payout/announcement suites remain applicable.

Missing/multiple guilds, a deleted owner or a database outage intentionally lock
out all dashboard users. Initial setup for a fresh installation is intentionally
disabled while this temporary policy is active; recovery/provisioning requires
separate review. The stored ownership relation is a trust anchor, not proof of
human intent; the mandatory independent check supplies that verification.

Authorization is not persistently cached. Already completed responses/client
screens cannot be recalled, and in-flight requests are not retroactively
cancelled. Setup conditionally checks ownership at the write; other existing
mutations retain their original transaction behavior. No new database heartbeat,
Prisma client, external service or automatic deployment is introduced.

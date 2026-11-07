-- Operator-only pre-deployment verification. Do not run automatically.
-- Independently verify the Neon PRODUCTION branch/endpoint in the console.
-- Substitute the two expected numeric IDs privately. Never publish this input.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '5s';
SET LOCAL search_path = public;

WITH expected(guild_discord_id, owner_discord_id) AS (
  VALUES ('REPLACE_WITH_EXPECTED_GUILD_DISCORD_ID',
          'REPLACE_WITH_EXPECTED_OWNER_DISCORD_ID')
)
SELECT CASE WHEN
  current_database() = 'neondb'
  AND current_schema() = 'public'
  AND current_setting('transaction_read_only') = 'on'
  AND (SELECT count(*) FROM public.guilds) = 1
  AND (
    SELECT count(*)
    FROM public.guilds AS g
    JOIN public.users AS u ON u.id = g."ownerId"
    JOIN public.discord_accounts AS a ON a."userId" = u.id
    CROSS JOIN expected AS e
    WHERE g."ownerId" IS NOT NULL
      AND g."ownerId" <> ''
      AND e.guild_discord_id ~ '^[0-9]{17,20}$'
      AND e.owner_discord_id ~ '^[0-9]{17,20}$'
      AND g."discordId" = e.guild_discord_id
      AND a."discordId" = e.owner_discord_id
  ) = 1
THEN 'PASS' ELSE 'FAIL' END AS verification;

ROLLBACK;

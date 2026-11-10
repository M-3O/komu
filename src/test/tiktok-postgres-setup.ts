import {
  TIKTOK_POSTGRES_SYNTHETIC_AUTH_SECRET,
  tiktokPostgresUrl,
} from "./tiktok-postgres-preflight";

const databaseUrl = tiktokPostgresUrl(process.env);

// This assignment happens only after the explicit local-disposable gate. The
// application database URL is required by Prisma, but it was absent before
// preflight and can never be inherited from the operator's shell.
process.env.DATABASE_URL = databaseUrl;
// The shared application selector intentionally knows only its production
// default and the separately guarded Neon TEST mode. Remove this suite-only
// selector before importing Prisma so it cannot be mistaken for either mode.
delete process.env.KOMU_DATABASE_TARGET;
delete process.env.KOMU_TIKTOK_DB_APPROVED;
delete process.env.KOMU_TIKTOK_DATABASE_URL;
process.env.AUTH_SECRET = TIKTOK_POSTGRES_SYNTHETIC_AUTH_SECRET;
process.env.DISCORD_CLIENT_ID = "synthetic-discord-client-id";
process.env.DISCORD_CLIENT_SECRET = "synthetic-discord-client-secret";
process.env.DISCORD_BOT_TOKEN = "synthetic-discord-bot-token";
process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";

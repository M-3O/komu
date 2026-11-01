import { config } from "dotenv";
import { defineConfig } from "prisma/config";

import { initializeDatabaseEnvironment } from "./src/lib/config/database-environment";

// Load `.env.local` (Next.js convention) so `npm run db:migrate` works
// without exporting DATABASE_URL first. `.env` is loaded as a fallback for
// CI, where a single file is usually provided.
config({ path: [".env.local", ".env"] });
initializeDatabaseEnvironment();

/**
 * Prisma CLI configuration.
 *
 * The `seed` command is declared here rather than in package.json, which
 * Prisma 7 will drop.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
});

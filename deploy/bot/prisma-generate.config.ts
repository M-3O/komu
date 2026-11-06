import { defineConfig } from "prisma/config";

// Generation-only CLI process: never load dotenv, the runtime selector, or Neon
// credentials. This assignment cannot change the parent shell/runtime environment.
process.env.DATABASE_URL = "postgresql://build:build@127.0.0.1:9/komu_build?connect_timeout=1";

// Relative to this config file, not the caller's current directory.
export default defineConfig({ schema: "../../prisma/schema.prisma" });

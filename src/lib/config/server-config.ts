import "server-only";

import { z } from "zod";

/**
 * Server-side environment validation.
 *
 * Fails fast at startup rather than letting a missing secret surface as a
 * confusing runtime error later (PRD section 11).
 *
 * Values are read lazily so `next build` does not need production secrets
 * just to compile a page.
 */

const schema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_CLIENT_SECRET: z.string().min(1),
  DISCORD_BOT_TOKEN: z.string().min(1),

  NEXT_PUBLIC_APP_URL: z
    .string()
    .url()
    .default("http://localhost:3000"),

  // Streaming providers are optional in V1: a creator may connect only
  // Twitch, for example.
  TWITCH_CLIENT_ID: z.string().optional(),
  TWITCH_CLIENT_SECRET: z.string().optional(),
  YOUTUBE_CLIENT_ID: z.string().optional(),
  YOUTUBE_CLIENT_SECRET: z.string().optional(),
  KICK_CLIENT_ID: z.string().optional(),
  KICK_CLIENT_SECRET: z.string().optional(),
});

export type ServerConfig = z.infer<typeof schema>;

let cached: ServerConfig | undefined;

/** Validate and return the server configuration. */
export function getServerConfig(): ServerConfig {
  if (cached) return cached;

  const parsed = schema.safeParse(process.env);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");

    throw new Error(
      `Invalid environment configuration:\n${details}\n\n` +
        "Copy .env.example to .env.local and fill in the values.",
    );
  }

  cached = parsed.data;
  return cached;
}

/**
 * The Discord OAuth redirect URI.
 *
 * Registered in the Discord developer portal as
 * `${NEXT_PUBLIC_APP_URL}/api/auth/callback`.
 */
export function getDiscordRedirectUri(): string {
  const { NEXT_PUBLIC_APP_URL } = getServerConfig();
  return `${NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/api/auth/callback`;
}
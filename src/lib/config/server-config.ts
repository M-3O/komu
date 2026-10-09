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

  /// Signs the session cookie. Generate with:
  ///   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),

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
  // Only the client id, which doubles as the Data API key. Google issues a
  // client secret alongside it, but a public API key needs no OAuth flow, so
  // there is nothing for a secret to be used in.
  YOUTUBE_CLIENT_ID: z.string().optional(),
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
 * The session signing secret, or null when it is not configured.
 *
 * Read leniently rather than through `getServerConfig`, so a missing secret
 * on a fresh checkout produces a helpful login screen instead of a crash on
 * every request.
 */
export function getAuthSecret(): string | null {
  const value = process.env.AUTH_SECRET;
  return value && value.length > 0 ? value : null;
}

/**
 * The Discord OAuth redirect URI.
 *
 * Registered in the Discord developer portal as
 * `${NEXT_PUBLIC_APP_URL}/callback`.
 */
export function getDiscordRedirectUri(): string {
  const { NEXT_PUBLIC_APP_URL } = getServerConfig();
  return `${NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/callback`;
}
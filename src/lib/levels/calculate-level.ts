/**
 * Level maths.
 *
 * V1 uses a quadratic curve: the XP required to reach level N is
 *
 *   xpForLevel(N) = 100 * N * (N + 1) / 2
 *
 * which gives level 2 at 100 XP, level 5 at 750, level 10 at 2,750 and
 * level 25 at 16,250. It is easy to explain to a community and grows fast
 * enough that early levels feel rewarding.
 *
 * The formula is isolated here so it can be replaced later without touching
 * the XP service.
 */

/** Base multiplier for the curve. Raising this slows all level-ups. */
export const XP_CURVE_BASE = 100;

/** Highest level the curve will return, as a guard against runaway input. */
export const MAX_LEVEL = 1000;

/** Total XP needed to reach a given level. Level 1 is always 0 XP. */
export function xpForLevel(level: number): number {
  if (level <= 1) return 0;
  const safeLevel = Math.min(level, MAX_LEVEL);
  return (XP_CURVE_BASE * safeLevel * (safeLevel + 1)) / 2;
}

/** The level a given XP total corresponds to. */
export function levelForXp(xp: number): number {
  if (xp <= 0) return 1;

  let level = 1;
  while (level < MAX_LEVEL && xpForLevel(level + 1) <= xp) {
    level++;
  }
  return level;
}

/** Progress within the current level, used by `/level` and the dashboard. */
export function levelProgress(xp: number): {
  level: number;
  currentLevelXp: number;
  nextLevelXp: number;
  xpIntoLevel: number;
  xpToNextLevel: number;
  percent: number;
} {
  const level = levelForXp(xp);
  const currentLevelXp = xpForLevel(level);
  const nextLevelXp = xpForLevel(level + 1);
  const xpIntoLevel = xp - currentLevelXp;
  const xpToNextLevel = nextLevelXp - currentLevelXp;
  const percent =
    xpToNextLevel > 0 ? Math.round((xpIntoLevel / xpToNextLevel) * 100) : 100;

  return {
    level,
    currentLevelXp,
    nextLevelXp,
    xpIntoLevel,
    xpToNextLevel,
    percent: Math.max(0, Math.min(100, percent)),
  };
}
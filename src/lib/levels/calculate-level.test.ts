import { describe, expect, it } from "vitest";

import { levelForXp, levelProgress, xpForLevel } from "./calculate-level";

describe("xpForLevel", () => {
  it("treats level 1 as free", () => {
    expect(xpForLevel(1)).toBe(0);
    expect(xpForLevel(0)).toBe(0);
  });

  it("uses the quadratic curve", () => {
    expect(xpForLevel(2)).toBe(300);
    expect(xpForLevel(3)).toBe(600);
    expect(xpForLevel(10)).toBe(5500);
    expect(xpForLevel(25)).toBe(32500);
  });

  it("is monotonically increasing", () => {
    for (let level = 1; level < 50; level++) {
      expect(xpForLevel(level + 1)).toBeGreaterThan(xpForLevel(level));
    }
  });
});

describe("levelForXp", () => {
  it("returns level 1 below the first threshold", () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(299)).toBe(1);
  });

  it("returns the level whose threshold has been reached", () => {
    expect(levelForXp(300)).toBe(2);
    expect(levelForXp(599)).toBe(2);
    expect(levelForXp(600)).toBe(3);
  });

  it("never returns below 1 for negative input", () => {
    expect(levelForXp(-500)).toBe(1);
  });

  it("round-trips with xpForLevel", () => {
    for (let level = 1; level <= 30; level++) {
      expect(levelForXp(xpForLevel(level))).toBe(level);
    }
  });
});

describe("levelProgress", () => {
  it("reports progress within the current level", () => {
    // Level 2 starts at 300 XP, level 3 at 600 XP.
    const progress = levelProgress(450);

    expect(progress.level).toBe(2);
    expect(progress.currentLevelXp).toBe(300);
    expect(progress.nextLevelXp).toBe(600);
    expect(progress.xpIntoLevel).toBe(150);
    expect(progress.xpToNextLevel).toBe(300);
    expect(progress.percent).toBe(50);
  });

  it("reports 0% exactly at a level boundary", () => {
    expect(levelProgress(300).percent).toBe(0);
  });

  it("clamps the percentage for overshoot", () => {
    expect(levelProgress(1_000_000).percent).toBeLessThanOrEqual(100);
    expect(levelProgress(-10).percent).toBe(0);
  });
});
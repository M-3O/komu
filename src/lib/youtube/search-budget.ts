import "server-only";

import { prisma } from "@/lib/db";

export async function reserveYouTubeSearch(now = new Date()) {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
  const configured = Number(process.env.YOUTUBE_DAILY_SEARCH_LIMIT ?? 100);
  const limit = Number.isSafeInteger(configured) && configured > 0 ? configured : 100;
  const reserved = await prisma.$queryRaw<Array<{ calls: number }>>`
    INSERT INTO youtube_search_budgets (day, calls) VALUES (${day}, 1)
    ON CONFLICT (day) DO UPDATE SET calls = youtube_search_budgets.calls + 1
    WHERE youtube_search_budgets.calls < ${limit}
    RETURNING calls
  `;
  return reserved.length > 0;
}

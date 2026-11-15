import { config } from "dotenv";
import { XPSource } from "@prisma/client";
import { parseArgs } from "node:util";

config({ path: [".env.local", ".env"] });

async function main() {
  const { positionals: [command], values } = parseArgs({
    allowPositionals: true,
    options: {
      guild: { type: "string" },
      attendance: { type: "string" },
      "verified-missing": { type: "boolean" },
    },
  });
  if (!values.guild || !["audit", "repair"].includes(command)) {
    throw new Error("Use audit --guild <Discord server ID> or repair --guild <ID> --attendance <ID> --verified-missing.");
  }
  const { initializeDatabaseEnvironment } = await import("../src/lib/config/database-environment");
  initializeDatabaseEnvironment();
  const { prisma } = await import("../src/lib/db");
  try {
    const guild = await prisma.guild.findUniqueOrThrow({ where: { discordId: values.guild }, select: { id: true } });
    if (command === "audit") {
      let cursor: string | undefined;
      for (;;) {
        const rows = await prisma.streamAttendance.findMany({
          where: { stream: { guildId: guild.id }, xpTransaction: null },
          include: { stream: { select: { title: true } } },
          orderBy: { id: "asc" }, take: 100, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });
        if (!rows.length) break;
        for (const row of rows) {
          const possible = await prisma.xPTransaction.count({ where: {
            guildId: guild.id, memberId: row.memberId, attendanceId: null, source: XPSource.STREAM_ATTENDANCE,
            amount: 25, reason: row.stream.title ? `Attended: ${row.stream.title}` : "Stream attendance",
            createdAt: { gte: row.createdAt, lte: new Date(+row.createdAt + 10 * 60_000) },
          } });
          console.log(JSON.stringify({ attendanceId: row.id, streamId: row.streamId, memberId: row.memberId,
            recordedAt: row.createdAt, review: possible ? "Possible matching legacy award" : "No matching legacy award found" }));
        }
        cursor = rows.at(-1)?.id;
      }
      return;
    }
    if (!values.attendance || !values["verified-missing"]) {
      throw new Error("Repair requires --attendance and --verified-missing after independent review.");
    }
    const { awardAttendanceXp } = await import("../src/lib/attendance/record-attendance");
    const repaired = await prisma.$transaction(async (tx) => {
      const row = await tx.streamAttendance.findFirstOrThrow({
        where: { id: values.attendance, stream: { guildId: guild.id }, member: { guildId: guild.id } },
        select: { id: true, memberId: true },
      });
      await tx.$queryRaw`SELECT id FROM guild_members WHERE id = ${row.memberId} FOR UPDATE`;
      const linked = await tx.xPTransaction.findUnique({ where: { attendanceId: row.id } });
      if (linked) return false;
      await awardAttendanceXp(tx, row.id, guild.id, row.memberId, "", true);
      return true;
    }, { maxWait: 10_000, timeout: 15_000 });
    console.log(repaired ? "Verified 25 XP correction recorded." : "This attendance already has a linked XP entry.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error && error.message.startsWith("Use audit") ? error.message
    : "Attendance XP operation failed. Check the target database and command arguments.");
  process.exitCode = 1;
});

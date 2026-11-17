export function seasonDateTimeFormatter(timeZone: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit",
    minute: "2-digit", hourCycle: "h23",
  });
}

export function seasonLocalDate(date: Date, timeZone: string) {
  const parts = Object.fromEntries(seasonDateTimeFormatter(timeZone).formatToParts(date).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/** Convert a wall clock time only when it identifies exactly one instant. */
export function parseSeasonDate(value: string, timeZone: string) {
  if (!/^20\d\d-\d\d-\d\dT\d\d:\d\d$/.test(value)) return null;
  const utc = Date.parse(value + "Z");
  if (!Number.isFinite(utc)) return null;
  try {
    const formatter = seasonDateTimeFormatter(timeZone);
    const offsets = new Set<number>();
    // Sample both sides of a possible time-zone transition to detect gaps and
    // repeated wall-clock times without using the server's local time zone.
    for (const hours of [-36, -12, 0, 12, 36]) {
      const candidate = new Date(utc + hours * 60 * 60_000);
      const parts = Object.fromEntries(formatter.formatToParts(candidate).map(({ type, value }) => [type, value]));
      offsets.add(Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}Z`) - +candidate);
    }
    const matches = [...offsets].map((offset) => new Date(utc - offset))
      .filter((date) => seasonLocalDate(date, timeZone) === value);
    return matches.length === 1 ? matches[0] : null;
  } catch {
    return null;
  }
}

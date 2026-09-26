/**
 * Indian calendar days and months. The business runs on India Standard Time (UTC+05:30
 * all year, no daylight saving), so "today", "this month" and a day's sales start at
 * midnight IST — not at UTC midnight, which is 05:30 IST.
 */
export const IST_TIME_ZONE = 'Asia/Kolkata';
export const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/** The moment shifted so its UTC fields read as the IST wall clock. */
function istWallClock(moment: Date): Date {
  return new Date(moment.getTime() + IST_OFFSET_MS);
}

/** The IST calendar date (YYYY-MM-DD) a moment falls on. */
export function istDateString(moment: Date): string {
  return istWallClock(moment).toISOString().slice(0, 10);
}

/** The instant the IST day containing `moment` starts (midnight IST). */
export function istStartOfDay(moment: Date): Date {
  const wall = istWallClock(moment);
  wall.setUTCHours(0, 0, 0, 0);
  return new Date(wall.getTime() - IST_OFFSET_MS);
}

/** The instant the IST month containing `moment` starts, shifted by `monthOffset` months. */
export function istStartOfMonth(moment: Date, monthOffset = 0): Date {
  const wall = istWallClock(moment);
  const start = Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth() + monthOffset, 1);
  return new Date(start - IST_OFFSET_MS);
}

/** SQL: the IST calendar day of a timestamptz column (a timestamp at IST midnight). */
export function sqlIstDay(column: string): string {
  return `date_trunc('day', ${column} AT TIME ZONE '${IST_TIME_ZONE}')`;
}

/** The instant the Indian financial year (1 April – 31 March, IST) containing `moment` starts. */
export function istFinancialYearStart(moment: Date): Date {
  const wall = istWallClock(moment);
  const year = wall.getUTCMonth() >= 3 ? wall.getUTCFullYear() : wall.getUTCFullYear() - 1;
  return new Date(Date.UTC(year, 3, 1) - IST_OFFSET_MS);
}

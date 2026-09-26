/** India Standard Time is UTC+05:30 all year (no daylight saving). */
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/**
 * The GST / TDS return period (YYYY-MM) a moment falls in. Returns are filed by Indian
 * calendar month, so the month is taken in IST: a sale at 00:30 on the 1st (IST) is in
 * that month, not the previous one as its UTC date would say.
 */
export function gstPeriodOf(moment: Date): string {
  return new Date(moment.getTime() + IST_OFFSET_MS).toISOString().slice(0, 7);
}

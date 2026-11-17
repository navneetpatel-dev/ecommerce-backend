/**
 * The platform's payout cycle (Platform Settings → Payout cycle).
 *
 * A payout run settles only sales delivered before the most recent cycle boundary, so a
 * WEEKLY platform pays each week's deliveries together instead of whatever happens to be
 * eligible the moment an admin presses "Process payouts". Boundaries are UTC midnights:
 * DAILY every day, WEEKLY every Monday, BIWEEKLY every other Monday, MONTHLY the 1st.
 */
export const PAYOUT_CYCLES = ['DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY'] as const;
export type PayoutCycle = (typeof PAYOUT_CYCLES)[number];

const DAY_MS = 24 * 60 * 60 * 1000;
/** A Monday (1970-01-05) so fortnightly periods always start on a Monday. */
const BIWEEKLY_ANCHOR_MS = Date.UTC(1970, 0, 5);

/** Settings written before the enum was enforced may be lower-case; anything unknown is weekly. */
export function normalizePayoutCycle(value: unknown): PayoutCycle {
  const upper = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return (PAYOUT_CYCLES as readonly string[]).includes(upper) ? (upper as PayoutCycle) : 'WEEKLY';
}

function startOfUtcDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/** The latest cycle boundary at or before `now`. */
export function lastPayoutBoundary(cycle: PayoutCycle, now: Date = new Date()): Date {
  const today = startOfUtcDay(now);
  switch (cycle) {
    case 'DAILY':
      return new Date(today);
    case 'WEEKLY': {
      const sinceMonday = (new Date(today).getUTCDay() + 6) % 7;
      return new Date(today - sinceMonday * DAY_MS);
    }
    case 'BIWEEKLY': {
      const periods = Math.floor((today - BIWEEKLY_ANCHOR_MS) / (14 * DAY_MS));
      return new Date(BIWEEKLY_ANCHOR_MS + periods * 14 * DAY_MS);
    }
    case 'MONTHLY':
      return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  }
}

/** The next cycle boundary after `now` — when the next batch of deliveries becomes payable. */
export function nextPayoutBoundary(cycle: PayoutCycle, now: Date = new Date()): Date {
  const last = lastPayoutBoundary(cycle, now);
  switch (cycle) {
    case 'DAILY':
      return new Date(last.getTime() + DAY_MS);
    case 'WEEKLY':
      return new Date(last.getTime() + 7 * DAY_MS);
    case 'BIWEEKLY':
      return new Date(last.getTime() + 14 * DAY_MS);
    case 'MONTHLY':
      return new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth() + 1, 1));
  }
}

/**
 * The delivery cutoff for one vendor's payout: the platform cycle's last boundary, or the
 * vendor's own preferred (longer) cycle when theirs ended earlier. A vendor can ask to be
 * paid less often than the platform default but never more often, so the platform's cash
 * flow stays in the admin's hands.
 */
export function payoutDeliveryCutoff(
  platformCycle: PayoutCycle,
  vendorPreference: unknown,
  now: Date = new Date(),
): Date {
  const platform = lastPayoutBoundary(platformCycle, now);
  if (!vendorPreference) return platform;
  const vendor = lastPayoutBoundary(normalizePayoutCycle(vendorPreference), now);
  return vendor < platform ? vendor : platform;
}

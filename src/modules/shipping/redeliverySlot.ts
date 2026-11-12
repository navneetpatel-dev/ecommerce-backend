import { z } from 'zod';
import { ValidationError } from '@core/errors/ValidationError';

/** The windows a courier can be asked to come back in. */
export const REDELIVERY_WINDOWS = {
  MORNING: 'morning (9am–12pm)',
  AFTERNOON: 'afternoon (12pm–4pm)',
  EVENING: 'evening (4pm–8pm)',
} as const;
export type RedeliveryWindow = keyof typeof REDELIVERY_WINDOWS;

/** The labels the web picker sent before it chose a date; they always meant tomorrow. */
const LEGACY_TOMORROW_LABELS: Record<string, RedeliveryWindow> = {
  'Tomorrow morning (9am - 12pm)': 'MORNING',
  'Tomorrow afternoon (12pm - 4pm)': 'AFTERNOON',
  'Tomorrow evening (4pm - 8pm)': 'EVENING',
};

export const MAX_REDELIVERY_DAYS_AHEAD = 14;
export const REDELIVERY_DATE_INVALID = `Choose a day from tomorrow to ${MAX_REDELIVERY_DAYS_AHEAD} days ahead`;

export const RescheduleDeliverySchema = z.union([
  z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, REDELIVERY_DATE_INVALID),
    window: z.enum(Object.keys(REDELIVERY_WINDOWS) as [RedeliveryWindow, ...RedeliveryWindow[]]),
  }),
  z.object({ slot: z.enum(Object.keys(LEGACY_TOMORROW_LABELS) as [string, ...string[]]) }),
]);
export type RescheduleDeliveryRequest = z.infer<typeof RescheduleDeliverySchema>;

/** Today's date in India as YYYY-MM-DD (deliveries run on Indian days). */
function indiaDate(now: Date, plusDays = 0): string {
  const shifted = new Date(now.getTime() + 5.5 * 3600_000 + plusDays * 86_400_000);
  return shifted.toISOString().slice(0, 10);
}

/**
 * The slot text stored on the shipment, from a validated request. The day must be
 * from tomorrow to 14 days ahead; a past date or free text is refused.
 */
export function resolveRedeliverySlot(input: RescheduleDeliveryRequest, now = new Date()): string {
  const { date, window } =
    'slot' in input ? { date: indiaDate(now, 1), window: LEGACY_TOMORROW_LABELS[input.slot]! } : input;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new ValidationError({ date: [REDELIVERY_DATE_INVALID] });
  }
  if (date < indiaDate(now, 1) || date > indiaDate(now, MAX_REDELIVERY_DAYS_AHEAD)) {
    throw new ValidationError({ date: [REDELIVERY_DATE_INVALID] });
  }
  return `${date}, ${REDELIVERY_WINDOWS[window]}`;
}

import { z } from 'zod';

/** Trimmed shopper text with human limits messages ("Answer must be at least 3 characters"). */
export function ugcText(label: string, limits: { min?: number; max: number }) {
  let schema = z.string().trim();
  if (limits.min) schema = schema.min(limits.min, `${label} must be at least ${limits.min} characters`);
  return schema.max(limits.max, `${label} must be at most ${limits.max} characters`);
}

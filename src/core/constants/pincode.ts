/**
 * Indian delivery PIN code — keep in sync with web `shared/constants/pincode.ts`.
 * Six digits; the first is the postal region, 1 to 8 (0 is unused and 9 is the
 * Army Postal Service, which this store does not deliver to). So 000000 and
 * 999999 are refused instead of being "deliverable" through the All India zone.
 */
export const PINCODE_LENGTH = 6;
export const PINCODE_PATTERN = /^[1-8]\d{5}$/;

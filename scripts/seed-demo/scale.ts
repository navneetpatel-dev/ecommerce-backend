/**
 * `DEMO_SEED_SIZE=small` builds a miniature of the same data (a few accounts, a handful of
 * rows each) for trying the seed quickly; the default is the full demo dataset.
 */
export const SMALL = process.env.DEMO_SEED_SIZE === 'small';

/** The full figure, or the small one when running small. */
export const scaled = (full: number, small: number): number => (SMALL ? small : full);

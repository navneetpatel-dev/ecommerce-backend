/**
 * Shared helpers for the demo seed: a deterministic random source, chunked inserts,
 * dates, and the Indian names, places and pincodes the rows are built from.
 */
import { randomUUID } from 'node:crypto';
import { QueryTypes } from 'sequelize';
import { sequelize } from '../../database/models';

/** Rows per INSERT: big enough to be fast, small enough for Postgres's parameter limit. */
const CHUNK = 500;

/** Mulberry32: the same seed gives the same data, so a re-run is reproducible. */
function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const random = mulberry32(20261109);

export const id = (): string => randomUUID();
export const int = (min: number, max: number): number => Math.floor(random() * (max - min + 1)) + min;
export const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
export const chance = (p: number): boolean => random() < p;

/** `n` distinct items (or all of them when there are fewer). */
export function sample<T>(items: readonly T[], n: number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy.slice(0, Math.min(n, copy.length));
}

/** Picks by weight: `[['A', 3], ['B', 1]]` gives A three times as often as B. */
export function weighted<T>(entries: ReadonlyArray<readonly [T, number]>): T {
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let roll = random() * total;
  for (const [value, w] of entries) {
    roll -= w;
    if (roll <= 0) return value;
  }
  return entries[entries.length - 1]![0];
}

const DAY = 86_400_000;
export const NOW = new Date();
export const daysAgo = (days: number): Date => new Date(NOW.getTime() - days * DAY);
export const addDays = (date: Date, days: number): Date => new Date(date.getTime() + days * DAY);
export const addHours = (date: Date, hours: number): Date => new Date(date.getTime() + hours * 3_600_000);
export const minDate = (a: Date, b: Date): Date => (a < b ? a : b);
/** A moment between two dates. */
export const between = (from: Date, to: Date): Date =>
  new Date(from.getTime() + random() * Math.max(0, to.getTime() - from.getTime()));

/** History the seed spans: two years, so yearly reports and payouts have depth. */
export const HISTORY_DAYS = 720;

/** Postgres array columns go in as array text, so an empty one still has a type. */
export const pgArray = (values: readonly string[]): string =>
  `{${values.map((value) => `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')}}`;

/** JSONB columns go in as JSON text through bulkInsert. */
export const json = (value: unknown): string => JSON.stringify(value);

/** Insert rows in chunks; returns how many went in. */
export async function insert(table: string, rows: Array<Record<string, unknown>>): Promise<number> {
  const qi = sequelize.getQueryInterface();
  for (let i = 0; i < rows.length; i += CHUNK) {
    await qi.bulkInsert(table, rows.slice(i, i + CHUNK));
  }
  return rows.length;
}

export async function select<T extends object>(sql: string, replacements: Record<string, unknown> = {}): Promise<T[]> {
  return sequelize.query<T>(sql, { type: QueryTypes.SELECT, replacements });
}

export async function exec(sql: string, replacements: Record<string, unknown> = {}): Promise<void> {
  await sequelize.query(sql, { replacements });
}

export const FIRST_NAMES = [
  'Aarav', 'Vivaan', 'Aditya', 'Vihaan', 'Arjun', 'Sai', 'Reyansh', 'Ayaan', 'Krishna', 'Ishaan',
  'Ananya', 'Diya', 'Aadhya', 'Saanvi', 'Pari', 'Anika', 'Navya', 'Myra', 'Sara', 'Kiara',
  'Rahul', 'Priya', 'Amit', 'Sneha', 'Vikram', 'Deepak', 'Kavita', 'Meera', 'Divya', 'Suresh',
  'Lakshmi', 'Karan', 'Pooja', 'Nikhil', 'Neha', 'Rohit', 'Shreya', 'Farhan', 'Zoya', 'Harpreet',
];
export const LAST_NAMES = [
  'Sharma', 'Patel', 'Kumar', 'Singh', 'Verma', 'Gupta', 'Reddy', 'Nair', 'Das', 'Joshi',
  'Iyer', 'Menon', 'Chatterjee', 'Banerjee', 'Mehta', 'Shah', 'Kapoor', 'Malhotra', 'Rao', 'Pillai',
];

/** City, state (as the app stores it) and a pincode prefix inside a shipping zone. */
export const PLACES = [
  { city: 'Mumbai', state: 'Maharashtra', prefix: '400' },
  { city: 'Pune', state: 'Maharashtra', prefix: '411' },
  { city: 'New Delhi', state: 'Delhi', prefix: '110' },
  { city: 'Bengaluru', state: 'Karnataka', prefix: '560' },
  { city: 'Hyderabad', state: 'Telangana', prefix: '500' },
  { city: 'Chennai', state: 'Tamil Nadu', prefix: '600' },
  { city: 'Kolkata', state: 'West Bengal', prefix: '700' },
  { city: 'Ahmedabad', state: 'Gujarat', prefix: '380' },
  { city: 'Jaipur', state: 'Rajasthan', prefix: '302' },
  { city: 'Lucknow', state: 'Uttar Pradesh', prefix: '226' },
  { city: 'Kochi', state: 'Kerala', prefix: '682' },
  { city: 'Chandigarh', state: 'Chandigarh', prefix: '160' },
] as const;

export const LOCALITIES = [
  'MG Road', 'Church Street', 'Park Avenue', 'Lake View Road', 'Gandhi Nagar', 'Patel Colony',
  'Market Road', 'Station Road', 'Jubilee Hills', 'Indiranagar', 'Koramangala', 'Bandra West',
  'Salt Lake', 'Anna Nagar', 'Civil Lines', 'Sector 17',
];

export const pincodeFor = (prefix: string): string => `${prefix}${String(int(1, 999)).padStart(3, '0')}`;
export const phone = (n: number): string => `+919${String(100000000 + (n % 899999999)).slice(0, 9)}`;
export const slugify = (text: string): string =>
  text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Prints how long a phase took. */
export async function phase<T>(name: string, run: () => Promise<T>): Promise<T> {
  const started = Date.now();
  console.log(`\n▶ ${name}`);
  const result = await run();
  console.log(`✓ ${name} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  return result;
}

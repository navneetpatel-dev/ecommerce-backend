/**
 * The seeded logins: one super admin, 100 vendors and 100 customers on random yopmail.com
 * addresses, so nobody can guess an inbox. Generated once into a git-ignored file and reused by
 * every later reseed. A yopmail inbox has no password: whoever learns an address can read its
 * sign-in codes and password resets, so these accounts are for development only.
 */
import { randomInt } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const VENDOR_COUNT = 100;
export const CUSTOMER_COUNT = 100;

export type Credentials = {
  generatedAt: string;
  /** One password per role. */
  passwords: { superAdmin: string; vendor: string; customer: string };
  superAdmin: string;
  vendors: string[];
  customers: string[];
};

const ROOT = path.resolve(__dirname, '../..');
export const CREDENTIALS_FILE = path.join(ROOT, 'seed-accounts.local.json');
export const CREDENTIALS_SHEET = path.join(ROOT, 'seed-accounts.local.csv');
export const CREDENTIALS_PAGE = path.join(ROOT, 'seed-accounts.local.md');

/** No look-alike characters (0/o, 1/l/i), so an address can be typed from the sheet. */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

const token = (length: number): string =>
  Array.from({ length }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');

/** Upper, lower, digit and symbol, 16 characters. */
const password = (): string => `${token(5).toUpperCase()}-${token(5)}-${randomInt(1000, 10000)}`;

const numbered = (prefix: string, count: number): string[] =>
  Array.from({ length: count }, (_, n) => `${prefix}${String(n + 1).padStart(3, '0')}-${token(10)}@yopmail.com`);

function generate(): Credentials {
  return {
    generatedAt: new Date().toISOString(),
    passwords: { superAdmin: password(), vendor: password(), customer: password() },
    superAdmin: `sa-${token(14)}@yopmail.com`,
    vendors: numbered('v', VENDOR_COUNT),
    customers: numbered('c', CUSTOMER_COUNT),
  };
}

function assertComplete(credentials: Credentials): Credentials {
  const emails = [credentials.superAdmin, ...credentials.vendors, ...credentials.customers];
  if (credentials.vendors.length !== VENDOR_COUNT || credentials.customers.length !== CUSTOMER_COUNT) {
    throw new Error(`${CREDENTIALS_FILE} must hold ${VENDOR_COUNT} vendors and ${CUSTOMER_COUNT} customers; delete it to generate a new set`);
  }
  if (new Set(emails).size !== emails.length) throw new Error(`${CREDENTIALS_FILE} repeats an email address`);
  return credentials;
}

/** The saved logins, generated and saved on first use. */
export function loadCredentials(): Credentials {
  if (existsSync(CREDENTIALS_FILE)) {
    return assertComplete(JSON.parse(readFileSync(CREDENTIALS_FILE, 'utf8')) as Credentials);
  }
  const credentials = assertComplete(generate());
  writeFileSync(CREDENTIALS_FILE, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
  return credentials;
}

export type SheetRow = { role: string; name: string; email: string; password: string };

/** Readable only by this user: it holds passwords. */
function writePrivate(file: string, content: string): void {
  writeFileSync(file, content, { mode: 0o600 });
  chmodSync(file, 0o600);
}

/** One section per role: its password, then every account's name and email. */
function markdown(rows: SheetRow[]): string {
  const cell = (value: string) => value.replace(/\|/g, '\\|');
  const sections = [...new Set(rows.map((row) => row.role))].map((role) => {
    const own = rows.filter((row) => row.role === role);
    return [
      `## ${role} (${own.length})`,
      '',
      `Password: \`${own[0]!.password}\``,
      '',
      '| # | Name | Email |',
      '|---|---|---|',
      ...own.map((row, index) => `| ${index + 1} | ${cell(row.name)} | ${row.email} |`),
    ].join('\n');
  });
  return [
    '# Development logins',
    '',
    'Private: git-ignored, rewritten by every reseed. A yopmail inbox has no password, so anyone',
    'who knows an address can read its sign-in codes. Do not share this file.',
    '',
    sections.join('\n\n'),
    '',
  ].join('\n');
}

/** The readable lists beside the credentials file: a spreadsheet and a Markdown page. */
export function writeCredentialSheet(rows: SheetRow[]): void {
  const cell = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const lines = [['role', 'name', 'email', 'password'], ...rows.map((r) => [r.role, r.name, r.email, r.password])];
  writePrivate(CREDENTIALS_SHEET, `${lines.map((line) => line.map(cell).join(',')).join('\n')}\n`);
  writePrivate(CREDENTIALS_PAGE, markdown(rows));
}

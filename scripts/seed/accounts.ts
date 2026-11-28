/**
 * Accounts: the super admin, 100 approved vendors (one login each, every KYC document
 * verified) and 100 customers, each customer with three delivery addresses. Emails and
 * passwords come from the credentials file (`credentials.ts`).
 */
import bcrypt from 'bcrypt';
import {
  FIRST_NAMES, HISTORY_DAYS, LAST_NAMES, LOCALITIES, PLACES, addDays, chance, daysAgo, exec, id, insert, int,
  json, phone, pick, pincodeFor, select, slugify, weighted, photo } from './lib';
import { CUSTOMER_COUNT, VENDOR_COUNT, type Credentials } from './credentials';

export type Customer = { id: string; email: string; name: string; status: string; createdAt: Date; consented: boolean };
export type VendorRow = {
  id: string;
  /** 1-based position, used in SKUs and invoice prefixes. */
  number: number;
  slug: string;
  businessName: string;
  state: string;
  status: string;
  commissionRate: number;
  ownerId: string;
  createdAt: Date;
};
export type Accounts = {
  superAdminId: string;
  /** Everyone who acts for the platform: the super admin. */
  adminIds: string[];
  customers: Customer[];
  vendors: VendorRow[];
  sellingVendors: VendorRow[];
  addressesByUser: Map<string, Array<{ id: string; state: string }>>;
};

export const ADDRESSES_PER_CUSTOMER = 3;
/** Customers who opted in to marketing mail, so that path can be tried out. */
const CONSENTING_CUSTOMERS = 3;

const GST_STATE_CODE: Record<string, string> = {
  Maharashtra: '27', Delhi: '07', Karnataka: '29', Telangana: '36', 'Tamil Nadu': '33', 'West Bengal': '19',
  Gujarat: '24', Rajasthan: '08', 'Uttar Pradesh': '09', Kerala: '32', Chandigarh: '04',
};

const SHOP_WORDS = [
  ['Urban', 'Royal', 'Green', 'Bright', 'Prime', 'Coastal', 'Desi', 'Nova', 'Silver', 'Golden', 'Swift', 'Lotus'],
  ['Peacock', 'Banyan', 'Monsoon', 'Saffron', 'Indigo', 'Marigold', 'Harbor', 'Summit', 'Meadow', 'Orchid', 'Cedar', 'River'],
  ['Co', 'Store', 'Mart', 'House', 'Studio', 'Traders', 'Emporium', 'Bazaar', 'Hub', 'Works'],
];

const DOCUMENT_TYPES = ['GST_CERT', 'PAN', 'AADHAAR', 'BANK_PROOF', 'ADDRESS_PROOF', 'AUTHORIZED_SIGNATORY_ID', 'INCORPORATION_CERT', 'PARTNERSHIP_DEED', 'FSSAI_LICENSE'];

function shopName(index: number): string {
  const [first, second, third] = SHOP_WORDS as [string[], string[], string[]];
  return `${first[index % 12]} ${second[Math.floor(index / 12) % 12]} ${third[index % 10]}`;
}

export function customerName(index: number): string {
  const first = FIRST_NAMES[index % FIRST_NAMES.length]!;
  const last = LAST_NAMES[(index + Math.floor(index / FIRST_NAMES.length) * 3) % LAST_NAMES.length]!;
  return `${first} ${last}`;
}

export function gstin(state: string, n: number): string {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const pan = `${letters[n % 24]}${letters[(n * 7) % 24]}${letters[(n * 3) % 24]}PK${String(1000 + (n % 9000))}${letters[(n * 5) % 24]}`;
  return `${GST_STATE_CODE[state] ?? '27'}${pan}1Z${letters[n % 24]}`;
}

async function roleIds(): Promise<Record<string, string>> {
  const rows = await select<{ id: string; name: string }>('SELECT id, name FROM roles');
  const ids = Object.fromEntries(rows.map((row) => [row.name, row.id]));
  for (const name of ['SUPER_ADMIN', 'VENDOR_OWNER', 'CUSTOMER']) {
    if (!ids[name]) throw new Error(`Role ${name} is missing: run \`npm run db:seed\` (it seeds the reference data first).`);
  }
  return ids;
}

function user(fields: Record<string, unknown>, createdAt: Date) {
  return {
    id: id(), status: 'ACTIVE', vendorId: null, emailVerified: true,
    emailMarketingConsent: false, emailSuppressed: false, createdAt, updatedAt: createdAt, ...fields,
  };
}

/** The one super admin: the reference seeder's row (from ADMIN_EMAIL) becomes this login. */
async function seedSuperAdmin(roleId: string, credentials: Credentials, createdAt: Date): Promise<string> {
  const admins = await select<{ id: string }>('SELECT id FROM users WHERE "roleId" = :roleId', { roleId });
  if (admins.length > 1) throw new Error('More than one super admin exists: seed a fresh database (`npm run db:reset`).');
  const passwordHash = await bcrypt.hash(credentials.passwords.superAdmin, 12);
  if (admins.length === 0) {
    const row = user({ email: credentials.superAdmin, name: 'Super Admin', roleId, passwordHash }, createdAt);
    await insert('users', [row]);
    return row.id;
  }
  await exec(
    `UPDATE users SET email = :email, name = 'Super Admin', "passwordHash" = :passwordHash, status = 'ACTIVE',
       "emailVerified" = true, "createdAt" = :createdAt, "updatedAt" = :createdAt WHERE id = :id`,
    { id: admins[0]!.id, email: credentials.superAdmin, passwordHash, createdAt },
  );
  return admins[0]!.id;
}

async function seedVendors(roleId: string, credentials: Credentials, superAdminId: string): Promise<VendorRow[]> {
  const passwordHash = await bcrypt.hash(credentials.passwords.vendor, 10);
  const vendors: Array<Record<string, unknown>> = [];
  const users: Array<Record<string, unknown>> = [];
  const documents: Array<Record<string, unknown>> = [];
  const result: VendorRow[] = [];
  for (let i = 0; i < VENDOR_COUNT; i += 1) {
    const number = i + 1;
    const businessName = shopName(i);
    const slug = slugify(businessName);
    const place = pick(PLACES);
    const createdAt = daysAgo(HISTORY_DAYS + int(10, 60));
    const vendorId = id();
    const commissionRate = pick([8, 10, 12, 12, 15]);
    const entityType = weighted([['SOLE_PROPRIETORSHIP', 5], ['PARTNERSHIP', 2], ['LLP', 1], ['PRIVATE_LIMITED', 2]] as const);
    vendors.push({
      id: vendorId, businessName, slug, gstNumber: gstin(place.state, i + 100), state: place.state,
      bankDetails: json({ accountNumber: `5010${String(100000000 + i)}`, ifscCode: `HDFC000${String(1000 + i).slice(-4)}`, accountHolderName: businessName, bankName: pick(['HDFC Bank', 'ICICI Bank', 'State Bank of India', 'Axis Bank']) }),
      logoUrl: photo(`${slug}-logo`), bannerUrl: photo(`${slug}-banner`),
      description: `${businessName} brings carefully sourced products from ${place.city}, packed with care and shipped fast.`,
      status: 'APPROVED', commissionRate, performanceScore: (3 + int(0, 200) / 100).toFixed(2),
      returnShippingFee: pick([0, 0, 40, 60]), entityType, codEnabled: chance(0.85), invoicePrefix: `V${String(number).padStart(3, '0')}`,
      addressLine1: `${int(1, 400)} ${pick(LOCALITIES)}`, city: place.city, pincode: pincodeFor(place.prefix),
      payoutFrequency: pick(['WEEKLY', 'BIWEEKLY', 'MONTHLY']), kycVerified: true,
      createdBy: superAdminId, createdAt, updatedAt: createdAt,
    });
    const owner = user({ email: credentials.vendors[i], name: customerName(i + 137), phone: phone(5000 + i), roleId, vendorId, passwordHash }, createdAt);
    users.push(owner);
    for (const type of DOCUMENT_TYPES) {
      const at = addDays(createdAt, int(1, 5));
      documents.push({
        id: id(), vendorId, type, url: photo(`kyc-${slug}-${type}`), verified: true, verifiedById: superAdminId,
        rejectionReason: null, rejectedAt: null, createdAt: at, updatedAt: at,
      });
    }
    result.push({ id: vendorId, number, slug, businessName, state: place.state, status: 'APPROVED', commissionRate, ownerId: owner.id, createdAt });
  }
  await insert('vendors', vendors);
  await insert('users', users);
  await insert('vendor_documents', documents);
  return result;
}

async function seedCustomers(roleId: string, credentials: Credentials): Promise<Customer[]> {
  const passwordHash = await bcrypt.hash(credentials.passwords.customer, 10);
  const customers: Customer[] = [];
  const rows: Array<Record<string, unknown>> = [];
  for (let i = 0; i < CUSTOMER_COUNT; i += 1) {
    const name = customerName(i);
    const email = credentials.customers[i]!;
    const createdAt = daysAgo(HISTORY_DAYS + int(5, 40));
    const consented = i < CONSENTING_CUSTOMERS;
    const row = user({
      email, name, phone: phone(10_000 + i), roleId, passwordHash, emailMarketingConsent: consented,
      avatarUrl: chance(0.5) ? `https://i.pravatar.cc/150?u=customer-${i + 1}` : null,
    }, createdAt);
    rows.push(row);
    customers.push({ id: row.id, email, name, status: 'ACTIVE', createdAt, consented });
  }
  await insert('users', rows);
  return customers;
}

async function seedAddresses(customers: Customer[]) {
  const rows: Array<Record<string, unknown>> = [];
  const byUser = new Map<string, Array<{ id: string; state: string }>>();
  for (const [index, customer] of customers.entries()) {
    const home = pick(PLACES);
    for (let i = 0; i < ADDRESSES_PER_CUSTOMER; i += 1) {
      const place = i < 2 ? home : pick(PLACES);
      const at = addDays(customer.createdAt, i);
      const addressId = id();
      rows.push({
        id: addressId, userId: customer.id, line1: `${int(1, 999)}, ${pick(LOCALITIES)}`,
        line2: chance(0.6) ? `${pick(['Flat', 'Floor', 'Block', 'Tower'])} ${int(1, 40)}` : null,
        city: place.city, state: place.state, country: 'India', pincode: pincodeFor(place.prefix),
        isDefault: i === 0, gstin: chance(0.05) ? gstin(place.state, index) : null,
        deliveryInstructions: chance(0.2) ? pick(['Leave with the security guard', 'Call before delivery', 'Ring the bell twice']) : null,
        recipientName: customer.name, recipientPhone: phone(10_000 + index).slice(-10),
        createdAt: at, updatedAt: at,
      });
      byUser.set(customer.id, [...(byUser.get(customer.id) ?? []), { id: addressId, state: place.state }]);
    }
  }
  await insert('addresses', rows);
  return byUser;
}

export async function seedAccounts(credentials: Credentials): Promise<Accounts> {
  const ids = await roleIds();
  const superAdminId = await seedSuperAdmin(ids.SUPER_ADMIN!, credentials, daysAgo(HISTORY_DAYS + 90));
  const vendors = await seedVendors(ids.VENDOR_OWNER!, credentials, superAdminId);
  const customers = await seedCustomers(ids.CUSTOMER!, credentials);
  const addressesByUser = await seedAddresses(customers);
  return { superAdminId, adminIds: [superAdminId], customers, vendors, sellingVendors: vendors, addressesByUser };
}

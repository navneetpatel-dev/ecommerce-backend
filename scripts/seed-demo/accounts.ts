/**
 * Accounts: custom admin roles, ten admin staff, vendors up to 120 (each with an owner,
 * a staff login and KYC documents), customers up to 300, and
 * at least 100 valid delivery addresses for every customer.
 */
import bcrypt from 'bcrypt';
import {
  FIRST_NAMES, HISTORY_DAYS, LAST_NAMES, LOCALITIES, PLACES, addDays, chance, daysAgo, exec, id, insert, int,
  json, phone, pick, pincodeFor, select, slugify, weighted,
} from './lib';
import { scaled } from './scale';

export type Customer = { id: string; email: string; name: string; status: string; createdAt: Date };
export type VendorRow = {
  id: string;
  slug: string;
  businessName: string;
  state: string;
  status: string;
  commissionRate: number;
  ownerId: string;
  staffId: string | null;
  createdAt: Date;
};
export type Accounts = {
  roleIds: Record<string, string>;
  adminIds: string[];
  superAdminId: string;
  customers: Customer[];
  vendors: VendorRow[];
  /** Vendors with a shop and history: approved, plus suspended ones (they traded before). */
  sellingVendors: VendorRow[];
  addressesByUser: Map<string, Array<{ id: string; state: string }>>;
};

export const TARGET_CUSTOMERS = scaled(300, 12);
export const TARGET_VENDORS = scaled(120, 8);
export const ADDRESSES_PER_CUSTOMER = scaled(100, 5);

const GST_STATE_CODE: Record<string, string> = {
  Maharashtra: '27', Delhi: '07', Karnataka: '29', Telangana: '36', 'Tamil Nadu': '33', 'West Bengal': '19',
  Gujarat: '24', Rajasthan: '08', 'Uttar Pradesh': '09', Kerala: '32', Chandigarh: '04',
};

const SHOP_WORDS = [
  ['Urban', 'Royal', 'Green', 'Bright', 'Prime', 'Coastal', 'Desi', 'Nova', 'Silver', 'Golden', 'Swift', 'Lotus'],
  ['Threads', 'Kitchen', 'Gadgets', 'Decor', 'Naturals', 'Footwear', 'Books', 'Toys', 'Sports', 'Crafts', 'Beauty', 'Electronics'],
  ['Co', 'Store', 'Mart', 'House', 'Studio', 'Traders', 'Emporium', 'Bazaar', 'Hub', 'Works'],
];

const CUSTOM_ROLES: Array<{ name: string; permissions: string[] }> = [
  { name: 'SUPPORT_AGENT', permissions: ['ticket.manage', 'bug_report.manage', 'order.manage'] },
  { name: 'FINANCE_ANALYST', permissions: ['analytics.view', 'commission.view', 'payout.view', 'payout.manage'] },
  { name: 'CONTENT_EDITOR', permissions: ['banner.manage', 'category.manage', 'product.update'] },
  { name: 'MARKETING_MANAGER', permissions: ['coupon.manage', 'banner.manage', 'analytics.view'] },
  { name: 'TRUST_AND_SAFETY', permissions: ['review.moderate', 'user.manage', 'vendor.approve'] },
  { name: 'LOGISTICS_LEAD', permissions: ['shipping.manage', 'suborder.manage', 'order.manage'] },
  { name: 'CATALOG_REVIEWER', permissions: ['product.approve', 'product.manage'] },
  { name: 'GIFT_CARD_DESK', permissions: ['gift_card.manage', 'wallet.adjust'] },
  { name: 'TAX_CONSULTANT', permissions: ['tax.manage', 'commission.view'] },
  { name: 'AUDITOR', permissions: ['audit.view', 'analytics.view'] },
];

async function seedRoles(now: Date): Promise<Record<string, string>> {
  const permissions = await select<{ id: string; key: string }>('SELECT id, key FROM permissions');
  const permissionId = new Map(permissions.map((row) => [row.key, row.id]));
  const existing = await select<{ name: string }>('SELECT name FROM roles');
  const have = new Set(existing.map((row) => row.name));
  const roles = CUSTOM_ROLES.filter((role) => !have.has(role.name)).map((role) => ({ ...role, id: id() }));
  await insert('roles', roles.map((role) => ({ id: role.id, name: role.name, createdAt: now, updatedAt: now })));
  await insert(
    'RolePermissions',
    roles.flatMap((role) =>
      role.permissions
        .filter((key) => permissionId.has(key))
        .map((key) => ({ roleId: role.id, permissionId: permissionId.get(key), createdAt: now, updatedAt: now })),
    ),
  );
  const all = await select<{ id: string; name: string }>('SELECT id, name FROM roles');
  return Object.fromEntries(all.map((row) => [row.name, row.id]));
}

function user(fields: Record<string, unknown>, passwordHash: string, createdAt: Date) {
  return {
    id: id(), passwordHash, status: 'ACTIVE', vendorId: null, emailVerified: true,
    emailMarketingConsent: false, emailSuppressed: false, createdAt, updatedAt: createdAt, ...fields,
  };
}

async function seedAdmins(roleIds: Record<string, string>, passwordHash: string) {
  const extra = [
    ['admin2@ecommerce.com', 'Neha Kapoor', 'SUPER_ADMIN'],
    ['ordermanager2@ecommerce.com', 'Rohit Mehta', 'ADMIN_ORDER_MANAGER'],
    ['ordermanager3@ecommerce.com', 'Ishaan Rao', 'ADMIN_ORDER_MANAGER'],
    ['catalogmanager2@ecommerce.com', 'Saanvi Iyer', 'ADMIN_CATALOG_MANAGER'],
    ['catalogmanager3@ecommerce.com', 'Farhan Shah', 'ADMIN_CATALOG_MANAGER'],
    ['support.agent@ecommerce.com', 'Divya Menon', 'SUPPORT_AGENT'],
    ['finance.analyst@ecommerce.com', 'Karan Malhotra', 'FINANCE_ANALYST'],
  ] as const;
  const have = new Set((await select<{ email: string }>('SELECT email FROM users')).map((row) => row.email));
  await insert(
    'users',
    extra
      .filter(([email]) => !have.has(email))
      .map(([email, name, role], index) =>
        user({ email, name, phone: phone(700 + index), roleId: roleIds[role] }, passwordHash, daysAgo(HISTORY_DAYS + 30)),
      ),
  );
  const admins = await select<{ id: string; role: string }>(
    `SELECT u.id, r.name AS role FROM users u JOIN roles r ON r.id = u."roleId"
     WHERE r.name NOT IN ('CUSTOMER', 'VENDOR_OWNER', 'VENDOR_STAFF') ORDER BY u."createdAt"`,
  );
  return { adminIds: admins.map((row) => row.id), superAdminId: admins.find((row) => row.role === 'SUPER_ADMIN')!.id };
}

function shopName(index: number): string {
  const [first, second, third] = SHOP_WORDS as [string[], string[], string[]];
  return `${first[index % 12]} ${second[Math.floor(index / 12) % 12]} ${third[index % 10]}`;
}

function gstin(state: string, n: number): string {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const pan = `${letters[n % 24]}${letters[(n * 7) % 24]}${letters[(n * 3) % 24]}PK${String(1000 + (n % 9000))}${letters[(n * 5) % 24]}`;
  return `${GST_STATE_CODE[state] ?? '27'}${pan}1Z${letters[n % 24]}`;
}

async function seedVendors(roleIds: Record<string, string>, passwordHash: string, superAdminId: string) {
  const existing = await select<{ count: string }>('SELECT count(*)::text AS count FROM vendors');
  const toAdd = Math.max(0, TARGET_VENDORS - Number(existing[0]!.count));
  const takenSlugs = new Set((await select<{ slug: string }>('SELECT slug FROM vendors')).map((row) => row.slug));
  const vendors: Array<Record<string, unknown>> = [];
  const users: Array<Record<string, unknown>> = [];
  for (let i = 0; i < toAdd; i += 1) {
    let businessName = shopName(i);
    let slug = slugify(businessName);
    if (takenSlugs.has(slug)) {
      businessName = `${businessName} ${i}`;
      slug = slugify(businessName);
    }
    takenSlugs.add(slug);
    const place = pick(PLACES);
    // Most shops trade; a few are waiting on KYC, were turned down, or are suspended.
    const status = weighted([['APPROVED', 88], ['PENDING', 5], ['REJECTED', 3], ['SUSPENDED', 4]] as const);
    const createdAt = daysAgo(HISTORY_DAYS + int(10, 60));
    const vendorId = id();
    vendors.push({
      id: vendorId, businessName, slug, gstNumber: gstin(place.state, i + 100), state: place.state,
      bankDetails: json({ accountNumber: `5010${String(100000000 + i)}`, ifscCode: `HDFC000${String(1000 + i).slice(-4)}`, accountHolderName: businessName, bankName: pick(['HDFC Bank', 'ICICI Bank', 'State Bank of India', 'Axis Bank']) }),
      logoUrl: `https://picsum.photos/seed/${slug}-logo/200/200`, bannerUrl: `https://picsum.photos/seed/${slug}-banner/1200/300`,
      description: `${businessName} brings carefully sourced products from ${place.city}, packed with care and shipped fast.`,
      status, commissionRate: pick([8, 10, 12, 12, 15, 18]), performanceScore: (3 + int(0, 200) / 100).toFixed(2),
      rejectionReason: status === 'REJECTED' ? 'GST certificate does not match the registered business name.' : null,
      suspensionReason: status === 'SUSPENDED' ? 'Repeated late dispatches under review by the trust team.' : null,
      returnShippingFee: pick([0, 0, 40, 60]), entityType: weighted([['SOLE_PROPRIETORSHIP', 5], ['PARTNERSHIP', 2], ['LLP', 1], ['PRIVATE_LIMITED', 2]] as const),
      codEnabled: chance(0.8), invoicePrefix: slug.replace(/-/g, '').slice(0, 8).toUpperCase(),
      addressLine1: `${int(1, 400)} ${pick(LOCALITIES)}`, city: place.city, pincode: pincodeFor(place.prefix),
      payoutFrequency: pick(['WEEKLY', 'BIWEEKLY', 'MONTHLY']), kycVerified: status === 'APPROVED' || status === 'SUSPENDED',
      createdBy: superAdminId, createdAt, updatedAt: createdAt,
    });
  }
  await insert('vendors', vendors);

  // Every vendor gets an owner and a staff login (older seeds left some without).
  const all = await select<{ id: string; slug: string; businessName: string; state: string; status: string; commissionRate: string; createdAt: Date }>(
    'SELECT id, slug, "businessName", state, status, "commissionRate"::text, "createdAt" FROM vendors ORDER BY "createdAt"',
  );
  const vendorUsers = await select<{ id: string; vendorId: string; role: string }>(
    `SELECT u.id, u."vendorId", r.name AS role FROM users u JOIN roles r ON r.id = u."roleId" WHERE u."vendorId" IS NOT NULL`,
  );
  const emails = new Set((await select<{ email: string }>('SELECT email FROM users')).map((row) => row.email));
  for (const [index, vendor] of all.entries()) {
    for (const role of ['VENDOR_OWNER', 'VENDOR_STAFF'] as const) {
      if (vendorUsers.some((row) => row.vendorId === vendor.id && row.role === role)) continue;
      const email = `${role === 'VENDOR_OWNER' ? 'owner' : 'staff'}@${vendor.slug}.com`;
      if (emails.has(email)) continue;
      emails.add(email);
      users.push(user({ email, name: `${vendor.businessName} ${role === 'VENDOR_OWNER' ? 'Owner' : 'Staff'}`, phone: phone(5000 + index * 2 + (role === 'VENDOR_OWNER' ? 0 : 1)), roleId: roleIds[role], vendorId: vendor.id }, passwordHash, vendor.createdAt));
    }
  }
  await insert('users', users);
  return all;
}

async function seedVendorKyc(vendors: Array<{ id: string; status: string; createdAt: Date }>, adminId: string) {
  const types = ['GST_CERT', 'PAN', 'AADHAAR', 'BANK_PROOF', 'ADDRESS_PROOF', 'AUTHORIZED_SIGNATORY_ID', 'INCORPORATION_CERT', 'PARTNERSHIP_DEED', 'FSSAI_LICENSE', 'CATEGORY_TRADE_LICENSE'];
  const have = await select<{ vendorId: string; type: string }>('SELECT "vendorId", type::text FROM vendor_documents');
  const owned = new Set(have.map((row) => `${row.vendorId}:${row.type}`));
  const rows: Array<Record<string, unknown>> = [];
  for (const vendor of vendors) {
    for (const type of types) {
      if (owned.has(`${vendor.id}:${type}`)) continue;
      const approved = vendor.status === 'APPROVED' || vendor.status === 'SUSPENDED';
      const outcome = approved ? 'VERIFIED' : weighted([['PENDING', 5], ['VERIFIED', 3], ['REJECTED', 2]] as const);
      const at = addDays(vendor.createdAt, int(1, 5));
      rows.push({
        id: id(), vendorId: vendor.id, type, url: `https://picsum.photos/seed/kyc-${vendor.id.slice(0, 8)}-${type}/800/1000`,
        verified: outcome === 'VERIFIED', verifiedById: outcome === 'VERIFIED' ? adminId : null,
        rejectionReason: outcome === 'REJECTED' ? 'The document is blurred; please upload a clearer scan.' : null,
        rejectedAt: outcome === 'REJECTED' ? at : null, createdAt: at, updatedAt: at,
      });
    }
  }
  await insert('vendor_documents', rows);
}

async function seedCustomers(roleIds: Record<string, string>, passwordHash: string) {
  const count = Number((await select<{ c: string }>(`SELECT count(*)::text AS c FROM users WHERE "roleId" = :r`, { r: roleIds.CUSTOMER }))[0]!.c);
  const emails = new Set((await select<{ email: string }>('SELECT email FROM users')).map((row) => row.email));
  const rows: Array<Record<string, unknown>> = [];
  for (let i = 0; rows.length < Math.max(0, TARGET_CUSTOMERS - count); i += 1) {
    const first = pick(FIRST_NAMES);
    const last = pick(LAST_NAMES);
    const email = `${first.toLowerCase()}.${last.toLowerCase()}.${200 + i}@example.com`;
    if (emails.has(email)) continue;
    emails.add(email);
    rows.push(user({
      email, name: `${first} ${last}`, phone: phone(10_000 + i), roleId: roleIds.CUSTOMER,
      status: chance(0.03) ? 'BLOCKED' : 'ACTIVE', emailMarketingConsent: chance(0.4),
      avatarUrl: chance(0.5) ? `https://i.pravatar.cc/150?u=${encodeURIComponent(email)}` : null,
    }, passwordHash, daysAgo(HISTORY_DAYS + int(5, 40))));
  }
  await insert('users', rows);
  // Older seeds stamped their accounts "now"; their history starts two years back too.
  await exec(`UPDATE users SET "createdAt" = :at, "updatedAt" = :at WHERE "createdAt" > :cut`, { at: daysAgo(HISTORY_DAYS + 45), cut: daysAgo(HISTORY_DAYS) });
  await exec(`UPDATE vendors SET "createdAt" = :at, "updatedAt" = :at WHERE "createdAt" > :cut`, { at: daysAgo(HISTORY_DAYS + 50), cut: daysAgo(HISTORY_DAYS) });
  return select<Customer>(
    `SELECT id, email, name, status::text, "createdAt" FROM users WHERE "roleId" = :r ORDER BY "createdAt", email`,
    { r: roleIds.CUSTOMER },
  );
}

async function seedAddresses(customers: Customer[]) {
  const counts = new Map(
    (await select<{ userId: string; c: string }>('SELECT "userId", count(*)::text AS c FROM addresses GROUP BY 1')).map((row) => [row.userId, Number(row.c)]),
  );
  // The first new address becomes the default: older seeds wrote 5-digit pincodes checkout rejects.
  await exec(`UPDATE addresses SET "isDefault" = false WHERE pincode !~ '^[1-9][0-9]{5}$'`);
  const rows: Array<Record<string, unknown>> = [];
  for (const customer of customers) {
    const need = Math.max(1, ADDRESSES_PER_CUSTOMER - (counts.get(customer.id) ?? 0));
    const home = pick(PLACES);
    for (let i = 0; i < need; i += 1) {
      const place = i < need / 2 ? home : pick(PLACES);
      const at = addDays(customer.createdAt, Math.min(i, 600));
      rows.push({
        id: id(), userId: customer.id, line1: `${int(1, 999)}, ${pick(LOCALITIES)}`,
        line2: chance(0.6) ? `${pick(['Flat', 'Floor', 'Block', 'Tower'])} ${int(1, 40)}` : null,
        city: place.city, state: place.state, country: 'India', pincode: pincodeFor(place.prefix),
        isDefault: i === 0, gstin: chance(0.05) ? gstin(place.state, i) : null,
        deliveryInstructions: chance(0.2) ? pick(['Leave with the security guard', 'Call before delivery', 'Ring the bell twice']) : null,
        createdAt: at, updatedAt: at,
      });
    }
  }
  await insert('addresses', rows);
  const valid = await select<{ id: string; userId: string; state: string }>(
    `SELECT id, "userId", state FROM addresses WHERE pincode ~ '^[1-9][0-9]{5}$' ORDER BY "isDefault" DESC, "createdAt"`,
  );
  const byUser = new Map<string, Array<{ id: string; state: string }>>();
  for (const row of valid) byUser.set(row.userId, [...(byUser.get(row.userId) ?? []), { id: row.id, state: row.state }]);
  return byUser;
}

export async function seedAccounts(): Promise<Accounts> {
  const passwordHash = await bcrypt.hash('Test@123', 10);
  const roleIds = await seedRoles(daysAgo(HISTORY_DAYS + 60));
  const { adminIds, superAdminId } = await seedAdmins(roleIds, passwordHash);
  const vendorRows = await seedVendors(roleIds, passwordHash, superAdminId);
  await seedVendorKyc(vendorRows, superAdminId);
  const customers = await seedCustomers(roleIds, passwordHash);
  const addressesByUser = await seedAddresses(customers);
  const owners = await select<{ id: string; vendorId: string; role: string }>(
    `SELECT u.id, u."vendorId", r.name AS role FROM users u JOIN roles r ON r.id = u."roleId"
     WHERE u."vendorId" IS NOT NULL ORDER BY u."createdAt"`,
  );
  const vendors: VendorRow[] = (await select<{ id: string; slug: string; businessName: string; state: string; status: string; commissionRate: string; createdAt: Date }>(
    'SELECT id, slug, "businessName", state, status::text, "commissionRate"::text, "createdAt" FROM vendors ORDER BY "createdAt", slug',
  )).map((row) => ({
    ...row,
    commissionRate: Number(row.commissionRate),
    ownerId: owners.find((u) => u.vendorId === row.id && u.role === 'VENDOR_OWNER')!.id,
    staffId: owners.find((u) => u.vendorId === row.id && u.role === 'VENDOR_STAFF')?.id ?? null,
  }));
  return {
    roleIds, adminIds, superAdminId, customers, vendors, addressesByUser,
    sellingVendors: vendors.filter((vendor) => vendor.status === 'APPROVED' || vendor.status === 'SUSPENDED'),
  };
}

/**
 * End-to-end fixtures for the catalog integration tests: the real app over HTTP, real auth and
 * permissions, and its own vendors, users and categories. These tests write data, so they are
 * skipped on the development database: point DB_NAME at a throwaway copy.
 */
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { QueryTypes } from 'sequelize';
import { env } from '@config/env';
import { sequelize, Role, User, Vendor, VendorDocument, Address, Category, ShippingZone, ShippingRate } from '@database/models';
import { ROLES, VENDOR_STATUS, type RoleName } from '@core/constants/statuses';
import { resolveRequiredDocuments } from '@modules/vendors/documentRequirements';

export const SKIP_ON_DEV_DB: false | string =
  env.DB_NAME === 'ecommerce_dev' ? 'writes data: point DB_NAME at a throwaway database' : false;

export type Actor = { id: string; email: string; token: string; vendorId: string | null };
export type TestVendor = { id: string; owner: Actor };
export type Reply = { status: number; data: any; error: any; text: string };
export type TestCategory = { id: string; name: string; slug: string };

export const rows = <T = any>(sql: string, replacements: Record<string, unknown> = {}) =>
  sequelize.query(sql, { type: QueryTypes.SELECT, replacements }) as Promise<T[]>;

let sequence = 0;
/** A short unique suffix for names, slugs and SKUs. */
export const unique = () => `${Date.now().toString(36)}${process.pid.toString(36)}${(sequence += 1)}`;

async function createActor(role: RoleName, vendorId: string | null = null): Promise<Actor> {
  const roleRow = await Role.findOne({ where: { name: role } });
  if (!roleRow) throw new Error(`role ${role} is missing: run the migrations and seeders`);
  const email = `fx-${unique()}@example.invalid`;
  const user = await User.create({ email, name: `Fixture ${role}`, roleId: roleRow.id, vendorId, status: 'ACTIVE', emailVerified: true } as never);
  const token = jwt.sign({ sub: user.id, email, roleId: roleRow.id, vendorId, roleName: role }, env.JWT_SECRET, { expiresIn: '30m' });
  return { id: user.id, email, token, vendorId };
}

/** An approved, KYC-verified vendor (with bank details, so leaks are detectable) and its login. */
async function createVendor(): Promise<TestVendor> {
  const tag = unique();
  const vendor = await Vendor.create({
    businessName: `Fixture Store ${tag}`,
    slug: `fixture-store-${tag}`,
    state: 'Karnataka',
    city: 'Bengaluru',
    pincode: '560001',
    addressLine1: '1 Test Road',
    gstNumber: '29ABCDE1234F1Z5',
    entityType: 'SOLE_PROPRIETORSHIP',
    bankDetails: { bankName: 'Test Bank', ifscCode: 'TEST0000001', accountNumber: `99${Date.now()}`, accountHolderName: `Holder ${tag}` },
    status: VENDOR_STATUS.APPROVED,
    kycVerified: true,
    commissionRate: 13.5,
  } as never);
  // Deliverable everywhere: one flat rate in every zone.
  for (const zone of await ShippingZone.findAll({ attributes: ['id'] })) {
    await ShippingRate.create({
      zoneId: zone.id, vendorId: vendor.id, method: 'STANDARD', minWeightGrams: 0, maxWeightGrams: 1_000_000, price: 50, estimatedDays: 3,
    } as never);
  }
  for (const type of await resolveRequiredDocuments(vendor.entityType!, [])) {
    await VendorDocument.create({ vendorId: vendor.id, type, url: 'https://example.invalid/doc.pdf', verified: true } as never);
  }
  return {
    id: vendor.id,
    owner: await createActor(ROLES.VENDOR_OWNER, vendor.id),
  };
}

export async function startCatalogWorld() {
  const { app } = await import('../app');
  const server: Server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;

  async function call(method: string, path: string, who?: Actor | null, body?: unknown, headers: Record<string, string> = {}): Promise<Reply> {
    const res = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', ...(who ? { authorization: `Bearer ${who.token}` } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* an empty or non-JSON body */
    }
    return { status: res.status, data: json?.data, error: json?.error, text };
  }

  const [a, b, admin, customer] = await Promise.all([
    createVendor(),
    createVendor(),
    createActor(ROLES.SUPER_ADMIN),
    createActor(ROLES.CUSTOMER),
  ]);
  const address = await Address.create({
    userId: customer.id, line1: '2 Buyer Street', city: 'Bengaluru', state: 'Karnataka', country: 'India',
    pincode: '560001', isDefault: true, recipientName: 'Fixture Buyer', recipientPhone: '9876543210',
  } as never);

  /** A category of its own, so tests never disturb the catalog's categories. */
  async function category(overrides: Record<string, unknown> = {}): Promise<TestCategory> {
    const tag = unique();
    return Category.create({ name: `Fixture Category ${tag}`, slug: `fixture-category-${tag}`, status: 'ACTIVE', ...overrides } as never);
  }

  const expectStatus = (reply: Reply, status: number, what: string) => {
    if (reply.status !== status) throw new Error(`${what}: expected ${status}, got ${reply.status} ${reply.text.slice(0, 300)}`);
    return reply;
  };

  /** A draft with one variant and one image, created through the API as the vendor would. */
  async function draftProduct(vendor: TestVendor, options: { categoryId?: string; price?: number; stock?: number; name?: string; product?: Record<string, unknown> } = {}) {
    const categoryId = options.categoryId ?? (await category()).id;
    const name = options.name ?? `Fixture Product ${unique()}`;
    const price = options.price ?? 100;
    const created = expectStatus(
      await call('POST', '/products', vendor.owner, { categoryId, name, description: 'fixture', basePrice: price, ...options.product }),
      201, 'create product',
    );
    const id = created.data.id as string;
    const variant = expectStatus(
      await call('POST', `/products/${id}/variants`, vendor.owner, { sku: `FX-${unique()}`, price, stock: options.stock ?? 10 }),
      201, 'add variant',
    );
    const image = expectStatus(
      await call('POST', `/products/${id}/images`, vendor.owner, { url: 'https://example.invalid/a.jpg', isPrimary: true }),
      201, 'add image',
    );
    return { id, name, categoryId, variantId: variant.data.id as string, imageId: image.data.id as string, slug: created.data.slug as string };
  }

  async function liveProduct(vendor: TestVendor, options: Parameters<typeof draftProduct>[1] = {}) {
    const product = await draftProduct(vendor, options);
    expectStatus(await call('POST', `/products/${product.id}/submit`, vendor.owner), 200, 'submit');
    const [state] = await rows<{ status: string }>('SELECT status FROM products WHERE id = :id', { id: product.id });
    if (state!.status !== 'LIVE') expectStatus(await call('POST', `/products/${product.id}/approve`, admin, {}), 200, 'approve');
    return product;
  }

  return {
    base, call, a, b, admin, customer, addressId: String(address.id),
    category, draftProduct, liveProduct, expectStatus, createActor, createVendor,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    requestId: () => randomUUID(),
  };
}

export type CatalogWorld = Awaited<ReturnType<typeof startCatalogWorld>>;

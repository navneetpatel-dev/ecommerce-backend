/**
 * Catalog: the category tree with filter attributes and GST rules, every vendor selling in
 * every category, and one live product per vendor per category (so each category holds as
 * many live products as there are vendors), plus a few drafts, pending, rejected and archived
 * listings for the moderation screens.
 *
 * Prices are even whole rupees, so GST (5/12/18%) and its CGST/SGST halves are exact paise:
 * the bills the pricing engine produces then add up to the paisa on every page.
 */
import { between, chance, pgArray, daysAgo, exec, id, insert, int, json, pick, sample, select, slugify, weighted, HISTORY_DAYS, photo } from './lib';
import { DEPARTMENTS, type Department, type Leaf } from './taxonomy';
import type { Accounts, VendorRow } from './accounts';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { buildGalleryUrls } = require('../../database/seeders/lib/product-gallery-images');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const {
  refreshProductDisplayPrices,
  alignMrpWithGstPrices,
  refreshAboveMrpFlags,
} = require('../../database/seeders/lib/product-display-price');

/** Listings that are not on sale, for the admin and vendor moderation screens. */
const OFF_SALE: Array<[status: 'PENDING_APPROVAL' | 'DRAFT' | 'REJECTED' | 'ARCHIVED', count: number]> = [
  ['PENDING_APPROVAL', 60], ['DRAFT', 60], ['REJECTED', 40], ['ARCHIVED', 40],
];
/** Vendors whose first products are bought and reviewed by every customer. */
const SHOWCASE_VENDORS = 5;
const SHOWCASE_PER_VENDOR = 4;

export type SellableVariant = {
  variantId: string;
  productId: string;
  productName: string;
  vendorId: string;
  categoryId: string;
  price: number;
};
export type Catalog = {
  leaves: Array<{ id: string; root: string }>;
  /** Live products' variants, by vendor: what orders, carts and wishlists are made of. */
  liveByVendor: Map<string, SellableVariant[]>;
  liveVariants: SellableVariant[];
  liveProductIds: string[];
  productsByVendor: Map<string, string[]>;
  /** One variant of each showcase product. */
  showcase: SellableVariant[];
};

type LeafRow = { id: string; slug: string; department: Department; leaf: Leaf };

const ADJECTIVES = ['Classic', 'Premium', 'Essential', 'Pro', 'Everyday', 'Smart', 'Eco', 'Royal', 'Urban', 'Comfort', 'Signature', 'Lite'];
const PRICE_BANDED = new Set(['fashion-men-clothing', 'fashion-women-clothing']);

/** Categories, reusing one a reference seeder already created (Food carries a document rule). */
async function seedCategories(now: Date): Promise<LeafRow[]> {
  const existing = new Map((await select<{ id: string; slug: string }>('SELECT id, slug FROM categories')).map((row) => [row.slug, row.id]));
  const roots: Array<Record<string, unknown>> = [];
  const children: Array<Record<string, unknown>> = [];
  const leaves: LeafRow[] = [];
  for (const [order, department] of DEPARTMENTS.entries()) {
    const fields = {
      name: department.name, parentId: null, imageUrl: photo(`cat-${department.slug}`), status: 'ACTIVE', displayOrder: order + 1,
      seoTitle: `Buy ${department.name} online`, seoDescription: `Shop ${department.name.toLowerCase()} from verified sellers.`,
      commissionRate: department.commissionRate, returnWindowDays: department.returnWindowDays, codEnabled: true,
      defaultWarrantyMonths: department.warrantyMonths, defaultWarrantyType: department.warrantyMonths ? 'MANUFACTURER' : null,
    };
    let rootId = existing.get(department.slug);
    if (rootId) {
      await exec(
        `UPDATE categories SET name = :name, "imageUrl" = :imageUrl, "displayOrder" = :displayOrder, "seoTitle" = :seoTitle,
           "seoDescription" = :seoDescription, "commissionRate" = :commissionRate, "returnWindowDays" = :returnWindowDays,
           "defaultWarrantyMonths" = :defaultWarrantyMonths, "defaultWarrantyType" = :defaultWarrantyType, "updatedAt" = :now WHERE id = :id`,
        { ...fields, id: rootId, now },
      );
    } else {
      rootId = id();
      roots.push({ id: rootId, slug: department.slug, ...fields, createdAt: now, updatedAt: now });
    }
    for (const [index, entry] of department.leaves.entries()) {
      const slug = `${department.slug}-${slugify(entry.name)}`;
      const leafId = id();
      leaves.push({ id: leafId, slug, department, leaf: entry });
      children.push({
        id: leafId, name: entry.name, slug, parentId: rootId, imageUrl: photo(`cat-${slug}`), status: 'ACTIVE', displayOrder: index + 1,
        seoTitle: `Buy ${entry.name} online`, seoDescription: `Shop ${entry.name.toLowerCase()} from verified sellers.`,
        commissionRate: index % 3 === 0 ? department.commissionRate + 1 : null, returnWindowDays: department.returnWindowDays,
        codEnabled: slug !== 'jewelry-rings', defaultWarrantyMonths: department.warrantyMonths,
        defaultWarrantyType: department.warrantyMonths ? 'MANUFACTURER' : null, createdAt: now, updatedAt: now,
      });
    }
  }
  await insert('categories', roots);
  await insert('categories', children);
  return leaves;
}

async function seedAttributesAndTax(leaves: LeafRow[], now: Date) {
  const attributes: Array<Record<string, unknown>> = [];
  const rules: Array<Record<string, unknown>> = [];
  for (const row of leaves) {
    const [name, options] = row.leaf.option;
    attributes.push(
      { id: id(), categoryId: row.id, name, type: 'ENUM', options: json(options), displayOrder: 1, createdAt: now, updatedAt: now },
      { id: id(), categoryId: row.id, name: 'Assured', type: 'BOOLEAN', options: json([]), displayOrder: 2, createdAt: now, updatedAt: now },
    );
    // Clothing is the GST price-band case: 5% up to ₹1,000 a piece, 12% above.
    const band = PRICE_BANDED.has(row.slug);
    rules.push({
      id: id(), categoryId: row.id, hsnCode: row.leaf.hsn, gstPercentage: band ? 5 : row.leaf.gst,
      priceBandThreshold: band ? 1000 : null, gstPercentageAbove: band ? 12 : null, createdAt: now, updatedAt: now,
    });
  }
  // Departments get a rule too (their categories keep their own, nearer rule).
  const roots = await select<{ id: string; slug: string }>(
    `SELECT c.id, c.slug FROM categories c WHERE c."parentId" IS NULL
       AND NOT EXISTS (SELECT 1 FROM tax_rules t WHERE t."categoryId" = c.id AND t."deletedAt" IS NULL)`,
  );
  for (const root of roots) {
    const first = DEPARTMENTS.find((department) => department.slug === root.slug)?.leaves[0];
    rules.push({ id: id(), categoryId: root.id, hsnCode: first?.hsn ?? '9999', gstPercentage: first?.gst ?? 18, priceBandThreshold: null, gstPercentageAbove: null, createdAt: now, updatedAt: now });
  }
  await insert('category_attributes', attributes);
  await insert('tax_rules', rules);
}

async function seedVendorCategories(vendors: VendorRow[], leaves: LeafRow[]) {
  await insert(
    'vendor_categories',
    vendors.flatMap((vendor) => leaves.map((row) => ({ id: id(), vendorId: vendor.id, categoryId: row.id, createdAt: vendor.createdAt, updatedAt: vendor.createdAt }))),
  );
}

/** An even whole-rupee price (see the header). */
const evenPrice = (min: number, max: number): number => 2 * int(Math.ceil(min / 2), Math.floor(max / 2));

type Batch = Record<'products' | 'variants' | 'images', Array<Record<string, unknown>>>;

function buildProduct(batch: Batch, vendor: VendorRow, row: LeafRow, serial: number, status: string, superAdminId: string): string {
  const { department, leaf: entry } = row;
  const productId = id();
  const brand = department.brands[(vendor.number + serial) % department.brands.length]!;
  const noun = entry.products[serial % entry.products.length]!;
  const model = `${department.slug.slice(0, 2).toUpperCase()}${serial}`;
  const name = `${brand} ${pick(ADJECTIVES)} ${noun} ${model}`;
  const basePrice = evenPrice(...entry.price);
  const createdAt = between(vendor.createdAt, daysAgo(HISTORY_DAYS - 30));
  const material = pick(department.material);
  const published = status === 'LIVE' || status === 'ARCHIVED';
  batch.products.push({
    id: productId, vendorId: vendor.id, categoryId: row.id, name, slug: `${slugify(name)}-${productId.slice(0, 6)}`,
    description: `${name} from ${brand}. A ${noun.toLowerCase()} made for everyday use, quality-checked by ${vendor.businessName} before dispatch and backed by easy returns.`,
    basePrice, compareAtPrice: chance(0.6) ? basePrice + evenPrice(50, Math.max(100, Math.round(basePrice * 0.6))) : null, status,
    approvedById: published ? superAdminId : null,
    rejectionNote: status === 'REJECTED' ? 'Images do not show the product clearly; please upload a plain-background shot.' : null,
    tags: pgArray([department.slug, slugify(entry.name), pick(['new', 'bestseller', 'trending', 'gift'])]),
    avgRating: 0, brand,
    specs: json({ Brand: brand, Type: noun, Material: material, 'Country of origin': 'India', 'Model No.': model }),
    highlights: pgArray([`${brand} quality assurance`, `Made of ${material.toLowerCase()}`, pick(['Free returns within the return window', 'Ships in 24 hours', 'Secure, tamper-evident packaging'])]),
    deliveryNote: 'Usually ships within 1–2 business days.', returnNote: `Easy returns within ${department.returnWindowDays} days of delivery.`,
    warrantyMonths: department.warrantyMonths, warrantyType: department.warrantyMonths ? 'MANUFACTURER' : null,
    hsnCode: entry.hsn, seoTitle: `${name} | ${vendor.businessName}`, seoDescription: `Buy ${name} online.`,
    videoUrl: chance(0.03) ? 'https://samplelib.com/lib/preview/mp4/sample-5s.mp4' : null,
    sizeChartUrl: department.slug === 'fashion' ? photo(`size-${row.slug}`) : null,
    codEnabled: chance(0.9), createdAt, updatedAt: createdAt,
  });
  const [option, values] = entry.option;
  const chosen = sample(values, int(1, Math.min(3, values.length)));
  for (const [index, value] of chosen.entries()) {
    // The first option is always in stock, so every listing can be bought; the others cover
    // the "only a few left" and "sold out" badges.
    const stock = index === 0 ? int(25, 400) : weighted([[int(20, 400), 82], [int(1, 5), 12], [0, 6]] as const);
    batch.variants.push({
      id: id(), productId, sku: `V${String(vendor.number).padStart(3, '0')}-${model}-${index + 1}`,
      attributes: json({ [option]: value }), price: basePrice + 2 * index * int(10, 60), stock, lowStockAt: 5,
      weightGrams: int(...entry.weight), createdAt, updatedAt: createdAt,
    });
  }
  const urls: string[] = buildGalleryUrls(department.slug, productId, int(4, 5));
  urls.forEach((url, index) => batch.images.push({ id: id(), productId, url, isPrimary: index === 0, createdAt, updatedAt: createdAt }));
  return productId;
}

async function seedProducts(accounts: Accounts, leaves: LeafRow[]): Promise<string[]> {
  const batch: Batch = { products: [], variants: [], images: [] };
  const showcaseIds: string[] = [];
  let serial = 10_000;
  for (const vendor of accounts.vendors) {
    for (const [index, row] of leaves.entries()) {
      serial += 1;
      const productId = buildProduct(batch, vendor, row, serial, 'LIVE', accounts.superAdminId);
      // Showcase products come from different departments.
      if (vendor.number <= SHOWCASE_VENDORS && index % 8 === vendor.number - 1 && index < SHOWCASE_PER_VENDOR * 8) showcaseIds.push(productId);
    }
  }
  for (const [status, count] of OFF_SALE) {
    for (let n = 0; n < count; n += 1) {
      serial += 1;
      buildProduct(batch, accounts.vendors[n % accounts.vendors.length]!, pick(leaves), serial, status, accounts.superAdminId);
    }
  }
  await insert('products', batch.products);
  await insert('product_variants', batch.variants);
  await insert('product_images', batch.images);
  return showcaseIds;
}

export async function seedCatalog(accounts: Accounts): Promise<Catalog> {
  const now = daysAgo(HISTORY_DAYS + 55);
  const leaves = await seedCategories(now);
  await seedAttributesAndTax(leaves, now);
  await seedVendorCategories(accounts.vendors, leaves);
  const showcaseIds = await seedProducts(accounts, leaves);
  const database = { sequelize: (await import('../../database/models')).sequelize };
  await refreshProductDisplayPrices(database);
  // The MRP includes GST: it must cover the dearest variant, and shows a discount or nothing.
  await alignMrpWithGstPrices(database);
  await exec(`UPDATE products SET "compareAtPrice" = NULL WHERE "compareAtPrice" IS NOT NULL AND "compareAtPrice" <= "displayPrice"
    AND NOT EXISTS (SELECT 1 FROM product_variants v WHERE v."productId" = products.id AND v.price > products."basePrice")`);
  await refreshAboveMrpFlags(database);

  // Orders, carts and wishlists use only in-stock, even-priced variants of live products.
  const rows = await select<SellableVariant & { price: string }>(
    `SELECT v.id AS "variantId", p.id AS "productId", p.name AS "productName", p."vendorId", p."categoryId", v.price::text AS price
     FROM product_variants v JOIN products p ON p.id = v."productId"
     WHERE p.status = 'LIVE' AND p."deletedAt" IS NULL AND v."deletedAt" IS NULL AND v.stock > 0
     ORDER BY p.slug, v.sku`,
  );
  const liveVariants = rows.map((row) => ({ ...row, price: Number(row.price) }));
  const liveByVendor = new Map<string, SellableVariant[]>();
  for (const row of liveVariants) liveByVendor.set(row.vendorId, [...(liveByVendor.get(row.vendorId) ?? []), row]);
  const productsByVendor = new Map<string, string[]>();
  for (const row of await select<{ id: string; vendorId: string }>('SELECT id, "vendorId" FROM products')) {
    productsByVendor.set(row.vendorId, [...(productsByVendor.get(row.vendorId) ?? []), row.id]);
  }
  const showcase = showcaseIds.map((productId) => liveVariants.find((variant) => variant.productId === productId)!);
  return {
    leaves: leaves.map((row) => ({ id: row.id, root: row.department.slug })),
    liveByVendor, liveVariants, liveProductIds: [...new Set(liveVariants.map((row) => row.productId))], productsByVendor, showcase,
  };
}

/**
 * Catalog: categories, filter attributes and GST rules to at least 100 each, the
 * categories every vendor sells in, and products up to 110 per selling vendor across
 * every product status, each with variants, a gallery and full product-page content.
 *
 * Prices are even whole rupees, so GST (5/12/18/28%) and its CGST/SGST halves are exact
 * paise: the bills the pricing engine produces then add up to the paisa on every page.
 */
import { between, chance, pgArray, daysAgo, exec, id, insert, int, json, pick, sample, select, slugify, weighted, HISTORY_DAYS, photo } from './lib';
import { scaled } from './scale';
import type { Accounts, VendorRow } from './accounts';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { buildGalleryUrls, resolveGalleryKey } = require('../../database/seeders/lib/product-gallery-images');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { refreshProductDisplayPrices } = require('../../database/seeders/lib/product-display-price');

export const PRODUCTS_PER_VENDOR = scaled(110, 12);
const MAIN_ROOTS = ['electronics', 'fashion', 'home', 'sports', 'beauty', 'books', 'toys', 'food', 'automotive', 'jewelry'];

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
};

const NEW_LEAVES: Record<string, string[]> = {
  electronics: ['Smart Home', 'Monitors', 'Printers', 'Power Banks', 'Drones'],
  fashion: ['Ethnic Wear', 'Sarees', 'Activewear', 'Socks', 'Belts'],
  home: ['Bedsheets', 'Cookware', 'Lighting', 'Wall Art', 'Storage'],
  sports: ['Yoga', 'Cycling', 'Badminton', 'Swimming'],
  beauty: ['Fragrances', 'Hair Care', 'Men Grooming'],
  books: ['Comics', 'Exam Prep', 'Children Books'],
  toys: ['Board Games', 'Puzzles', 'STEM Kits'],
  food: ['Dry Fruits', 'Tea & Coffee', 'Spices'],
  automotive: ['Car Care', 'Bike Accessories'],
  jewelry: ['Silver', 'Earrings', 'Bangles'],
};

const ADJECTIVES = ['Classic', 'Premium', 'Essential', 'Pro', 'Ultra', 'Smart', 'Eco', 'Royal', 'Urban', 'Comfort', 'Signature', 'Lite'];
const BRANDS = ['Aurelia', 'Northwind', 'Kalash', 'Vistara', 'Mithila', 'Zephyr', 'Saffron', 'Banyan', 'Indigo', 'Tanvi', 'Orbit', 'Kairo'];
const COLORS = ['Black', 'White', 'Navy', 'Olive', 'Maroon', 'Grey', 'Teal', 'Mustard'];
const SIZES = ['S', 'M', 'L', 'XL', 'XXL'];
const FINISHES = ['Matte', 'Glossy', 'Textured'];

async function seedCategories(now: Date) {
  const roots = await select<{ id: string; slug: string }>(
    `SELECT id, slug FROM categories WHERE "parentId" IS NULL AND slug IN (:roots)`,
    { roots: MAIN_ROOTS },
  );
  const slugs = new Set((await select<{ slug: string }>('SELECT slug FROM categories')).map((row) => row.slug));
  const rows: Array<Record<string, unknown>> = [];
  for (const root of roots) {
    for (const [index, name] of (NEW_LEAVES[root.slug] ?? []).entries()) {
      const slug = `${root.slug}-${slugify(name)}`;
      if (slugs.has(slug)) continue;
      rows.push({
        id: id(), name, slug, parentId: root.id, imageUrl: photo(`cat-${slug}`),
        status: 'ACTIVE', displayOrder: 20 + index, seoTitle: `Buy ${name} online`, seoDescription: `Shop ${name.toLowerCase()} from trusted sellers.`,
        commissionRate: pick([null, 8, 10, 12]), returnWindowDays: pick([7, 10, 15, 30]), codEnabled: true,
        defaultWarrantyMonths: root.slug === 'electronics' ? 12 : null, defaultWarrantyType: root.slug === 'electronics' ? 'MANUFACTURER' : null,
        createdAt: now, updatedAt: now,
      });
    }
  }
  await insert('categories', rows);
  return select<{ id: string; root: string }>(
    `SELECT c.id, r.slug AS root FROM categories c JOIN categories r ON r.id = c."parentId"
     WHERE r.slug IN (:roots) AND c.status = 'ACTIVE' AND c."deletedAt" IS NULL
       AND NOT EXISTS (SELECT 1 FROM categories k WHERE k."parentId" = c.id)`,
    { roots: MAIN_ROOTS },
  );
}

async function seedAttributesAndTax(leaves: Array<{ id: string; root: string }>, now: Date) {
  const withAttrs = new Set((await select<{ c: string }>('SELECT DISTINCT "categoryId" AS c FROM category_attributes')).map((row) => row.c));
  const attributes: Array<Record<string, unknown>> = [];
  for (const leaf of leaves.filter((row) => !withAttrs.has(row.id))) {
    attributes.push(
      { id: id(), categoryId: leaf.id, name: 'Color', type: 'ENUM', options: json(COLORS), displayOrder: 1, createdAt: now, updatedAt: now },
      // Options are always a list (the facet builder maps over them), and the second
      // attribute is one every variant carries, so its filter values match real products.
      leaf.root === 'fashion'
        ? { id: id(), categoryId: leaf.id, name: 'Size', type: 'ENUM', options: json(SIZES), displayOrder: 2, createdAt: now, updatedAt: now }
        : { id: id(), categoryId: leaf.id, name: 'Finish', type: 'ENUM', options: json(FINISHES), displayOrder: 2, createdAt: now, updatedAt: now },
      { id: id(), categoryId: leaf.id, name: 'Assured', type: 'BOOLEAN', options: json([]), displayOrder: 3, createdAt: now, updatedAt: now },
    );
  }
  await insert('category_attributes', attributes);

  const ruled = new Set((await select<{ c: string }>('SELECT "categoryId" AS c FROM tax_rules WHERE "categoryId" IS NOT NULL')).map((row) => row.c));
  const rates: Record<string, number> = { electronics: 18, fashion: 12, home: 18, sports: 12, beauty: 18, books: 12, toys: 12, food: 5, automotive: 28, jewelry: 12 };
  const rules = leaves.filter((row) => !ruled.has(row.id)).map((leaf, index) => {
    // Apparel is the GST price-band case: 5% up to ₹1,000 a piece, 12% above.
    const band = leaf.root === 'fashion' && index % 2 === 0;
    return {
      id: id(), categoryId: leaf.id, hsnCode: String(int(1000, 9999)), gstPercentage: band ? 5 : rates[leaf.root] ?? 18,
      priceBandThreshold: band ? 1000 : null, gstPercentageAbove: band ? 12 : null, createdAt: now, updatedAt: now,
    };
  });
  // Top-level categories get a rule too (their leaves keep their own, nearer rule).
  const roots = await select<{ id: string; slug: string }>(
    `SELECT c.id, c.slug FROM categories c WHERE c."parentId" IS NULL
       AND NOT EXISTS (SELECT 1 FROM tax_rules t WHERE t."categoryId" = c.id)`,
  );
  for (const root of roots) {
    rules.push({ id: id(), categoryId: root.id, hsnCode: String(int(1000, 9999)), gstPercentage: rates[root.slug] ?? 18, priceBandThreshold: null, gstPercentageAbove: null, createdAt: now, updatedAt: now });
  }
  await insert('tax_rules', rules);
}

async function seedVendorCategories(vendors: VendorRow[], leaves: Array<{ id: string }>) {
  const have = new Set((await select<{ v: string; c: string }>('SELECT "vendorId" AS v, "categoryId" AS c FROM vendor_categories')).map((row) => `${row.v}:${row.c}`));
  const rows = vendors.flatMap((vendor) =>
    sample(leaves, int(8, 14))
      .filter((leaf) => !have.has(`${vendor.id}:${leaf.id}`))
      .map((leaf) => ({ id: id(), vendorId: vendor.id, categoryId: leaf.id, createdAt: vendor.createdAt, updatedAt: vendor.createdAt })),
  );
  await insert('vendor_categories', rows);
}

/** An even whole-rupee price (see the header). */
const evenPrice = (min: number, max: number): number => 2 * int(Math.ceil(min / 2), Math.floor(max / 2));

async function seedProducts(accounts: Accounts, leaves: Array<{ id: string; root: string }>) {
  const counts = new Map((await select<{ v: string; c: string }>('SELECT "vendorId" AS v, count(*)::text AS c FROM products GROUP BY 1')).map((row) => [row.v, Number(row.c)]));
  const vendorLeaves = await select<{ v: string; c: string }>('SELECT "vendorId" AS v, "categoryId" AS c FROM vendor_categories');
  const leafRoot = new Map(leaves.map((leaf) => [leaf.id, leaf.root]));
  const products: Array<Record<string, unknown>> = [];
  const variants: Array<Record<string, unknown>> = [];
  const images: Array<Record<string, unknown>> = [];
  const secondary: Array<Record<string, unknown>> = [];
  let serial = int(10_000, 20_000);
  for (const vendor of accounts.sellingVendors) {
    const own = vendorLeaves.filter((row) => row.v === vendor.id && leafRoot.has(row.c)).map((row) => row.c);
    const pool = own.length ? own : leaves.map((leaf) => leaf.id);
    const need = Math.max(0, PRODUCTS_PER_VENDOR - (counts.get(vendor.id) ?? 0));
    for (let i = 0; i < need; i += 1) {
      serial += 1;
      const categoryId = pick(pool);
      const root = leafRoot.get(categoryId) ?? 'electronics';
      const status = i < need * 0.75 ? 'LIVE' : weighted([['PENDING_APPROVAL', 3], ['DRAFT', 3], ['REJECTED', 2], ['ARCHIVED', 2], ['LIVE', 2]] as const);
      const productId = id();
      const brand = pick(BRANDS);
      const name = `${brand} ${pick(ADJECTIVES)} ${root === 'books' ? 'Edition' : 'Collection'} ${serial}`;
      const basePrice = evenPrice(98, root === 'electronics' || root === 'jewelry' ? 24_998 : 4_998);
      const createdAt = between(vendor.createdAt, daysAgo(HISTORY_DAYS - 30));
      products.push({
        id: productId, vendorId: vendor.id, categoryId, name, slug: `${slugify(name)}-${productId.slice(0, 6)}`,
        description: `${name} by ${brand}: thoughtfully made, quality-checked by ${vendor.businessName}, and backed by easy returns.`,
        basePrice, compareAtPrice: chance(0.6) ? basePrice + evenPrice(50, Math.max(100, basePrice * 0.6)) : null, status,
        approvedById: status === 'LIVE' || status === 'ARCHIVED' ? accounts.superAdminId : null,
        rejectionNote: status === 'REJECTED' ? 'Images do not show the product clearly; please upload a plain-background shot.' : null,
        tags: pgArray([root, pick(['new', 'bestseller', 'trending', 'gift']), brand.toLowerCase()]),
        avgRating: 0, brand,
        specs: json({ Brand: brand, Material: pick(['Cotton', 'Steel', 'Wood', 'ABS', 'Glass', 'Leather']), Origin: 'India', 'Model No.': `M-${serial}` }),
        highlights: pgArray([`Made by ${brand}`, pick(['1-year warranty', 'Free returns within 7 days', 'Eco-friendly packaging']), pick(['Ships in 24 hours', 'Top rated seller', 'Assured quality'])]),
        deliveryNote: 'Usually ships within 1–2 business days.', returnNote: 'Easy returns within the return window.',
        warrantyMonths: root === 'electronics' ? pick([6, 12, 24]) : null, warrantyType: root === 'electronics' ? pick(['MANUFACTURER', 'SELLER']) : null,
        hsnCode: String(int(1000, 9999)), seoTitle: `${name} | ${vendor.businessName}`, seoDescription: `Buy ${name} online.`,
        videoUrl: chance(0.1) ? 'https://samplelib.com/lib/preview/mp4/sample-5s.mp4' : null,
        sizeChartUrl: root === 'fashion' ? photo(`size-${productId.slice(0, 6)}`) : null,
        codEnabled: chance(0.85), createdAt, updatedAt: createdAt,
      });
      const variantCount = int(1, 3);
      // One finish per product, so colour stays the only choice between its variants.
      const finish = pick(FINISHES);
      for (let v = 0; v < variantCount; v += 1) {
        // Stock covers every badge: plenty, low (≤ 5) and sold out.
        const stock = weighted([[int(20, 400), 80], [int(1, 5), 12], [0, 8]] as const);
        variants.push({
          id: id(), productId, sku: `SKU-${serial}-${v + 1}`,
          attributes: json(root === 'fashion' ? { Size: SIZES[v % SIZES.length], Color: pick(COLORS) } : { Color: COLORS[v % COLORS.length], Finish: finish }),
          price: basePrice + 2 * v * int(10, 100), stock, lowStockAt: 5, weightGrams: int(150, 2500), createdAt, updatedAt: createdAt,
        });
      }
      const urls: string[] = buildGalleryUrls(resolveGalleryKey ? resolveGalleryKey(root) : root, productId, 5);
      urls.forEach((url, index) => images.push({ id: id(), productId, url, isPrimary: index === 0, createdAt, updatedAt: createdAt }));
      if (chance(0.15)) {
        const other = pick(leaves).id;
        if (other !== categoryId) secondary.push({ id: id(), productId, categoryId: other, createdAt, updatedAt: createdAt });
      }
    }
  }
  await insert('products', products);
  await insert('product_variants', variants);
  await insert('product_images', images);
  await insert('product_categories', secondary);
}

export async function seedCatalog(accounts: Accounts): Promise<Catalog> {
  const now = daysAgo(HISTORY_DAYS + 55);
  const leaves = await seedCategories(now);
  await seedAttributesAndTax(leaves, now);
  await seedVendorCategories(accounts.vendors, leaves);
  await seedProducts(accounts, leaves);
  await refreshProductDisplayPrices({ sequelize: (await import('../../database/models')).sequelize });
  // A product's MRP is never below its GST-inclusive price.
  await exec(`UPDATE products SET "compareAtPrice" = NULL WHERE "compareAtPrice" IS NOT NULL AND "compareAtPrice" <= "displayPrice"`);

  // Orders, carts and wishlists use only even-priced variants of live products (see header).
  const rows = await select<SellableVariant & { price: string }>(
    `SELECT v.id AS "variantId", p.id AS "productId", p.name AS "productName", p."vendorId", p."categoryId", v.price::text AS price
     FROM product_variants v JOIN products p ON p.id = v."productId"
     WHERE p.status = 'LIVE' AND p."deletedAt" IS NULL AND v."deletedAt" IS NULL
       AND v.price = round(v.price) AND mod(v.price::int, 2) = 0 AND p."vendorId" IS NOT NULL`,
  );
  const liveVariants = rows.map((row) => ({ ...row, price: Number(row.price) }));
  const liveByVendor = new Map<string, SellableVariant[]>();
  for (const row of liveVariants) liveByVendor.set(row.vendorId, [...(liveByVendor.get(row.vendorId) ?? []), row]);
  const productsByVendor = new Map<string, string[]>();
  for (const row of await select<{ id: string; vendorId: string }>('SELECT id, "vendorId" FROM products WHERE "vendorId" IS NOT NULL')) {
    productsByVendor.set(row.vendorId, [...(productsByVendor.get(row.vendorId) ?? []), row.id]);
  }
  return { leaves, liveByVendor, liveVariants, liveProductIds: [...new Set(liveVariants.map((row) => row.productId))], productsByVendor };
}

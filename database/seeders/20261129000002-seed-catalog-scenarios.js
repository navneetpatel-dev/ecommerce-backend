'use strict';

const { randomUUID } = require('node:crypto');
const { assertSeedingAllowed } = require('../seedGuard');
const { buildGalleryUrls, resolveGalleryKey, MIN_PRODUCT_GALLERY_IMAGES } = require('./lib/product-gallery-images');
const { refreshProductDisplayPrices, refreshAboveMrpFlags } = require('./lib/product-display-price');
const { SHOPPER_EMAIL, GUEST_ALERT_EMAIL, VENDOR_SLUG, CATEGORIES, PRODUCTS } = require('./lib/catalog-scenarios');

/**
 * Example data for the catalog rules (see `lib/catalog-scenarios.js`). Runs last, after the MRP
 * alignment, because one listing is above its MRP on purpose (the integrity audit reports it).
 *
 * Safe to re-run: a product that already exists is left alone, and so is everything attached to it.
 */

function helpers(queryInterface, now) {
  const { sequelize } = queryInterface;
  const one = async (sql, replacements = {}) =>
    (await sequelize.query(sql, { replacements, type: sequelize.QueryTypes.SELECT }))[0];
  const insert = async (table, row) => {
    const full = { id: randomUUID(), createdAt: now, updatedAt: now, ...row };
    await queryInterface.bulkInsert(table, [full]);
    return full.id;
  };
  return { sequelize, one, insert };
}

async function ensureCategory({ one, insert }, spec) {
  const found = await one(`SELECT id FROM categories WHERE slug = :slug AND "deletedAt" IS NULL`, { slug: spec.slug });
  if (found) return found.id;
  const parent = await one(`SELECT id FROM categories WHERE slug = :slug AND "deletedAt" IS NULL`, { slug: spec.parent });
  if (!parent) throw new Error(`Scenario seed needs the "${spec.parent}" category: run the earlier seeders first.`);
  const categoryId = await insert('categories', {
    name: spec.name, slug: spec.slug, parentId: parent.id, status: 'ACTIVE', displayOrder: 50,
    commissionRate: spec.commissionRate, codEnabled: spec.codEnabled, returnWindowDays: 7,
  });
  if (spec.tax) await insert('tax_rules', { categoryId, ...spec.tax });
  for (const [index, attribute] of (spec.attributes ?? []).entries()) {
    await insert('category_attributes', {
      categoryId, name: attribute.name, type: 'ENUM', options: JSON.stringify(attribute.options), displayOrder: index,
    });
  }
  return categoryId;
}

/** Creates one scenario product; returns its option ids, or null when it already exists. */
async function createProduct(db, spec, context) {
  const { one, insert, sequelize } = db;
  if (await one(`SELECT id FROM products WHERE slug = :slug`, { slug: spec.slug })) return null;
  const category = await one(`SELECT id, name, slug FROM categories WHERE slug = :slug AND "deletedAt" IS NULL`, { slug: spec.category });
  if (!category) throw new Error(`Scenario seed needs the "${spec.category}" category.`);

  const status = spec.status ?? 'LIVE';
  const kept = spec.options.filter(([, , , flags]) => !flags?.removed);
  const prices = kept.map(([, price]) => price);
  const productId = await insert('products', {
    vendorId: context.vendorId, categoryId: category.id, name: spec.name, slug: spec.slug,
    description: `${spec.name}. ${spec.note}`, brand: 'Scenario Lab',
    basePrice: Math.min(...prices),
    // Above the dearest option even at the highest GST rate, so only a listed `mrp` can fall short.
    compareAtPrice: spec.mrp ?? Math.ceil(Math.max(...prices) * 1.4),
    status, rejectionNote: spec.rejectionNote ?? null,
    approvedById: status === 'LIVE' || status === 'ARCHIVED' ? context.superAdminId : null,
    listedByPlatform: Boolean(spec.listedByPlatform),
    vendorConsentNote: spec.listedByPlatform ? 'Confirmed by the owner by phone (scenario data).' : null,
    createdBy: spec.listedByPlatform ? context.catalogManagerId : context.ownerId,
    avgRating: 0,
  });
  await sequelize.query(
    `UPDATE products SET tags = ARRAY['scenario'], highlights = ARRAY[:note]::text[],
       "deliveryNote" = 'Usually ships within 1–2 business days.', "returnNote" = 'Easy returns within 7 days.'
     WHERE id = :productId`,
    { replacements: { productId, note: spec.note.slice(0, 160) } },
  );

  const optionIds = [];
  for (const [index, [attributes, price, stock, flags]] of spec.options.entries()) {
    optionIds.push(await insert('product_variants', {
      productId, sku: `${spec.slug}-${index + 1}`.toUpperCase(), price, stock, lowStockAt: 5, weightGrams: 400,
      attributes: JSON.stringify(attributes), deletedAt: flags?.removed ? context.now : null,
    }));
  }
  const gallery = buildGalleryUrls(resolveGalleryKey(category.slug, category.name), productId, MIN_PRODUCT_GALLERY_IMAGES);
  for (const [index, url] of gallery.entries()) await insert('product_images', { productId, url, isPrimary: index === 0 });

  if (spec.secondary) {
    const other = await one(`SELECT id FROM categories WHERE slug = :slug AND "deletedAt" IS NULL`, { slug: spec.secondary });
    await insert('product_categories', { productId, categoryId: other.id });
  }
  return { productId, optionIds, price: Math.min(...prices) };
}

/** The shopper's wishlist and cart, and who is waiting for a sold-out option. */
async function shopperData(db, shopperId, created) {
  const { one, insert } = db;
  const ensureOwned = async (table) =>
    (await one(`SELECT id FROM ${table} WHERE "userId" = :shopperId AND "deletedAt" IS NULL LIMIT 1`, { shopperId }))?.id ??
    insert(table, { userId: shopperId });

  const sneakers = created.get('scenario-sold-out-sneakers');
  if (sneakers) {
    await insert('wishlist_items', { wishlistId: await ensureOwned('wishlists'), productId: sneakers.productId, priceAtAdd: sneakers.price });
    await insert('stock_alerts', { userId: shopperId, guestEmail: null, variantId: sneakers.optionIds[0] });
    await insert('stock_alerts', { userId: null, guestEmail: GUEST_ALERT_EMAIL, variantId: sneakers.optionIds[1] });
  }
  const mouse = created.get('scenario-removed-option-mouse');
  if (mouse) {
    await insert('cart_items', { cartId: await ensureOwned('carts'), variantId: mouse.optionIds[0], quantity: 1 });
  }
}

/** A few entries so the audit trail shows the new kinds of change. */
async function auditData({ insert }, context, created) {
  const record = (actorId, action, entityType, entityId, metadata) =>
    insert('audit_logs', { actorId, action, entityType, entityId, metadata: JSON.stringify({ ...metadata, seed: true }) });
  const { vendorId } = context;

  const webcam = created.get('scenario-platform-listed-webcam');
  if (webcam) {
    for (const action of ['PRODUCT_CREATED_ON_BEHALF', 'PRODUCT_SUBMITTED_ON_BEHALF']) {
      await record(context.catalogManagerId, action, 'Product', webcam.productId, {
        vendorId, name: 'Scenario Platform Listed Webcam', onBehalfOfVendor: true,
      });
    }
  }
  const headphones = created.get('scenario-low-stock-headphones');
  if (headphones) {
    await record(context.ownerId, 'PRODUCT_LIVE_EDITED_BY_VENDOR', 'Product', headphones.productId, {
      vendorId, name: 'Scenario Low Stock Headphones', changedFields: ['name'],
      before: { name: 'Scenario Headphones' }, after: { name: 'Scenario Low Stock Headphones' },
    });
  }
  if (created.has('scenario-prepaid-drone')) {
    await record(context.superAdminId, 'CATEGORY_RATE_CHANGED', 'Category', context.categoryIds.get('electronics-prepaid-only'), {
      vendorId, products: 1, reason: 'New commission agreed for prepaid gadgets (scenario data).', onBehalfOfVendor: true,
    });
  }
}

module.exports = {
  async up(queryInterface) {
    assertSeedingAllowed('20261129000002-seed-catalog-scenarios.js');
    const now = new Date();
    const db = helpers(queryInterface, now);
    const userId = async (sql, replacements) => (await db.one(sql, replacements))?.id;
    const byEmail = (email) => userId(`SELECT id FROM users WHERE email = :email AND "deletedAt" IS NULL`, { email });
    const byRole = (role) => userId(
      `SELECT u.id FROM users u INNER JOIN roles r ON r.id = u."roleId" WHERE r.name = :role AND u."deletedAt" IS NULL ORDER BY u."createdAt", u.email LIMIT 1`,
      { role },
    );

    const vendorId = (await db.one(`SELECT id FROM vendors WHERE slug = :slug AND "deletedAt" IS NULL`, { slug: VENDOR_SLUG }))?.id;
    const context = {
      now,
      vendorId,
      ownerId: await byEmail(`owner@${VENDOR_SLUG}.com`),
      superAdminId: await byRole('SUPER_ADMIN'),
      catalogManagerId: await byRole('ADMIN_CATALOG_MANAGER'),
      categoryIds: new Map(),
    };
    const shopperId = await byEmail(SHOPPER_EMAIL);
    if (!vendorId || !context.ownerId || !context.superAdminId || !context.catalogManagerId || !shopperId) {
      console.log('⏭ Catalog scenarios skipped: the demo vendor, admins or shopper are not seeded');
      return;
    }

    for (const spec of CATEGORIES) {
      const categoryId = await ensureCategory(db, spec);
      context.categoryIds.set(spec.slug, categoryId);
      if (!(await db.one(`SELECT 1 AS found FROM vendor_categories WHERE "vendorId" = :vendorId AND "categoryId" = :categoryId AND "deletedAt" IS NULL`, { vendorId, categoryId }))) {
        await db.insert('vendor_categories', { vendorId, categoryId });
      }
    }

    const created = new Map();
    for (const spec of PRODUCTS) {
      const product = await createProduct(db, spec, context);
      if (product) created.set(spec.slug, product);
    }
    await shopperData(db, shopperId, created);
    await auditData(db, context, created);

    await refreshProductDisplayPrices(queryInterface);
    await refreshAboveMrpFlags(queryInterface);
    console.log(`✓ Catalog scenarios: ${created.size} product(s) added under TechWorld (shopper ${SHOPPER_EMAIL})`);
  },

  async down() {},
};

'use strict';

const { assertSeedingAllowed } = require('../seedGuard');

const { randomUUID } = require('crypto');

function bankDetails(name, suffix) {
  return JSON.stringify({
    accountNumber: `VIS${String(suffix).padStart(12, '0')}`,
    ifscCode: `SBIN00VIS${suffix}`,
    accountHolderName: name,
    bankName: 'State Bank of India',
  });
}

async function hasRow(queryInterface, sql) {
  const [rows] = await queryInterface.sequelize.query(sql);
  return rows.length > 0;
}

/** Every listed product has an option and a picture; added only where one is missing. */
async function ensureListing(queryInterface, product, now) {
  const [[row]] = await queryInterface.sequelize.query(
    `SELECT id FROM products WHERE slug = :slug LIMIT 1`,
    { replacements: { slug: product.slug } },
  );
  if (!row) return;
  const has = async (table) => {
    const [found] = await queryInterface.sequelize.query(
      `SELECT 1 FROM ${table} WHERE "productId" = :id AND "deletedAt" IS NULL LIMIT 1`,
      { replacements: { id: row.id } },
    );
    return found.length > 0;
  };
  if (!(await has('product_variants'))) {
    await queryInterface.bulkInsert('product_variants', [
      { id: randomUUID(), productId: row.id, sku: `${product.slug}-default`, price: product.basePrice, stock: 20, lowStockAt: 5, attributes: JSON.stringify({ Size: 'Standard' }), createdAt: now, updatedAt: now },
    ]);
  }
  if (!(await has('product_images'))) {
    await queryInterface.bulkInsert('product_images', [
      { id: randomUUID(), productId: row.id, url: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=600&fit=crop', isPrimary: true, createdAt: now, updatedAt: now },
    ]);
  }
}

/**
 * Cross-role visibility scenarios (see docs/archive/cross-role-visibility-implementation-doc.md §7 / §15).
 * Idempotent: each piece is inserted only if its marker slug is missing.
 */
module.exports = {
  async up(queryInterface) {
    assertSeedingAllowed('20240101000005-seed-visibility-scenarios.js');
    const now = new Date();

    let suspendedVendorId;
    let approvedVendorId;
    let archivedCategoryId;

    const [suspendedRows] = await queryInterface.sequelize.query(
      `SELECT id FROM vendors WHERE slug = 'visibility-suspended-shop' LIMIT 1`,
    );
    if (suspendedRows[0]?.id) {
      suspendedVendorId = suspendedRows[0].id;
    } else {
      suspendedVendorId = randomUUID();
      await queryInterface.bulkInsert('vendors', [
        {
          id: suspendedVendorId,
          businessName: 'Visibility Suspended Shop',
          slug: 'visibility-suspended-shop',
          gstNumber: '29AABCV1111A1Z5',
          state: 'Karnataka',
          bankDetails: bankDetails('Visibility Suspended Shop', 1),
          logoUrl: null,
          bannerUrl: null,
          description: 'Suspended vendor — products must stay hidden from customers.',
          status: 'SUSPENDED',
          entityType: 'SOLE_PROPRIETORSHIP',
          addressLine1: '1 Market Road',
          city: 'Bengaluru',
          pincode: '560001',
          commissionRate: 10,
          performanceScore: 0,
          createdAt: now,
          updatedAt: now,
        },
      ]);
    }

    const [approvedRows] = await queryInterface.sequelize.query(
      `SELECT id FROM vendors WHERE slug = 'visibility-approved-shop' LIMIT 1`,
    );
    if (approvedRows[0]?.id) {
      approvedVendorId = approvedRows[0].id;
    } else {
      approvedVendorId = randomUUID();
      await queryInterface.bulkInsert('vendors', [
        {
          id: approvedVendorId,
          businessName: 'Visibility Approved Shop',
          slug: 'visibility-approved-shop',
          gstNumber: '29AABCV2222B1Z5',
          state: 'Karnataka',
          bankDetails: bankDetails('Visibility Approved Shop', 2),
          logoUrl: null,
          bannerUrl: null,
          description: 'Approved vendor used for pending-product and archived-category cases.',
          status: 'APPROVED',
          entityType: 'SOLE_PROPRIETORSHIP',
          addressLine1: '1 Market Road',
          city: 'Bengaluru',
          pincode: '560001',
          commissionRate: 10,
          performanceScore: 4.2,
          createdAt: now,
          updatedAt: now,
        },
      ]);
    }

    const [archivedRows] = await queryInterface.sequelize.query(
      `SELECT id FROM categories WHERE slug = 'visibility-archived-category' LIMIT 1`,
    );
    if (archivedRows[0]?.id) {
      archivedCategoryId = archivedRows[0].id;
    } else {
      archivedCategoryId = randomUUID();
      await queryInterface.bulkInsert('categories', [
        {
          id: archivedCategoryId,
          name: 'Visibility Archived Category',
          slug: 'visibility-archived-category',
          status: 'ARCHIVED',
          parentId: null,
          imageUrl: null,
          createdAt: now,
          updatedAt: now,
        },
      ]);
    }

    const [activeCats] = await queryInterface.sequelize.query(
      `SELECT id FROM categories WHERE status = 'ACTIVE' LIMIT 1`,
    );
    const categoryId = activeCats[0]?.id ?? archivedCategoryId;

    const products = [
      {
        id: randomUUID(),
        vendorId: suspendedVendorId,
        categoryId,
        name: 'Live Product On Suspended Vendor',
        slug: 'live-on-suspended-vendor',
        description: 'Should be invisible to customers everywhere.',
        basePrice: 499,
        status: 'LIVE',
        tags: ['visibility', 'seed'],
        avgRating: 0,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: randomUUID(),
        vendorId: approvedVendorId,
        categoryId,
        name: 'Pending Approval Product',
        slug: 'pending-approval-visibility',
        description: 'Invisible to customers; visible to vendor/admin.',
        basePrice: 299,
        status: 'PENDING_APPROVAL',
        tags: ['visibility', 'seed'],
        avgRating: 0,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: randomUUID(),
        vendorId: approvedVendorId,
        categoryId: archivedCategoryId,
        name: 'Live Product In Archived Category',
        slug: 'live-in-archived-category',
        description: 'Hidden from the shop and cannot be bought, because its category is archived.',
        basePrice: 199,
        status: 'LIVE',
        tags: ['visibility', 'seed'],
        avgRating: 0,
        createdAt: now,
        updatedAt: now,
      },
    ];

    for (const product of products) {
      const exists = await hasRow(
        queryInterface,
        `SELECT id FROM products WHERE slug = '${product.slug}' LIMIT 1`,
      );
      if (!exists) {
        await queryInterface.bulkInsert('products', [product]);
      }
      await ensureListing(queryInterface, product, now);
    }
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('products', {
      slug: [
        'live-on-suspended-vendor',
        'pending-approval-visibility',
        'live-in-archived-category',
      ],
    });
    await queryInterface.bulkDelete('categories', { slug: 'visibility-archived-category' });
    await queryInterface.bulkDelete('vendors', {
      slug: ['visibility-suspended-shop', 'visibility-approved-shop'],
    });
  },
};

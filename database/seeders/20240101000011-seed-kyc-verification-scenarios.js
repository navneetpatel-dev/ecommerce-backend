'use strict';

/**
 * Verification scenarios for vendor KYC (reportable fixtures).
 * Safe to re-run: deletes prior rows tagged with slug prefix kyc-scenario-%.
 *
 * (1) Sole proprietorship + non-food category → base 6 docs only
 * (2) LLP + food category → base + PARTNERSHIP_DEED + FSSAI_LICENSE
 * (3) Approved vendor with verified base docs + non-food LIVE product + food category
 *     linked (FSSAI outstanding) — food products blocked from LIVE; APPROVED status kept
 */

const { v4: uuidv4 } = require('uuid');

const SEED_TAG = 'kyc-verification';

const BASE_DOC_TYPES = [
  'GST_CERT',
  'PAN',
  'AADHAAR',
  'BANK_PROOF',
  'ADDRESS_PROOF',
  'AUTHORIZED_SIGNATORY_ID',
];

async function ensureCategoryBySlug(queryInterface, slug, now) {
  let [cats] = await queryInterface.sequelize.query(
    `SELECT id FROM categories WHERE slug = :slug AND "deletedAt" IS NULL LIMIT 1`,
    { replacements: { slug } },
  );
  if (cats.length === 0) {
    const id = uuidv4();
    await queryInterface.bulkInsert('categories', [
      {
        id,
        name: slug.charAt(0).toUpperCase() + slug.slice(1),
        slug,
        parentId: null,
        status: 'ACTIVE',
        displayOrder: 100,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    cats = [{ id }];
  }
  return cats[0].id;
}

module.exports = {
  async up(queryInterface) {
    const now = new Date();
    const [roles] = await queryInterface.sequelize.query(
      `SELECT id, name FROM roles WHERE name IN ('VENDOR_OWNER', 'CUSTOMER')`,
    );
    const ownerRole = roles.find((r) => r.name === 'VENDOR_OWNER');
    if (!ownerRole) {
      throw new Error('KYC scenario seed requires VENDOR_OWNER role');
    }

    const foodId = await ensureCategoryBySlug(queryInterface, 'food', now);
    const [nonFood] = await queryInterface.sequelize.query(
      `SELECT id FROM categories
       WHERE slug <> 'food'
         AND "parentId" IS NULL
         AND "deletedAt" IS NULL
         AND slug NOT IN ('liquor', 'pharma', 'fireworks')
       LIMIT 1`,
    );
    if (nonFood.length === 0) {
      throw new Error('KYC scenario seed requires at least one non-food root category');
    }
    const nonFoodId = nonFood[0].id;

    // Clean previous fixture rows
    await queryInterface.sequelize.query(
      `DELETE FROM products WHERE slug LIKE 'kyc-scenario-%'`,
    );
    await queryInterface.sequelize.query(
      `DELETE FROM vendor_documents WHERE "vendorId" IN (
         SELECT id FROM vendors WHERE slug LIKE 'kyc-scenario-%'
       )`,
    );
    await queryInterface.sequelize.query(
      `DELETE FROM vendor_categories WHERE "vendorId" IN (
         SELECT id FROM vendors WHERE slug LIKE 'kyc-scenario-%'
       )`,
    );
    await queryInterface.sequelize.query(
      `UPDATE users SET "vendorId" = NULL WHERE "vendorId" IN (
         SELECT id FROM vendors WHERE slug LIKE 'kyc-scenario-%'
       )`,
    );
    await queryInterface.sequelize.query(
      `DELETE FROM vendors WHERE slug LIKE 'kyc-scenario-%'`,
    );

    const scenarios = [
      {
        slug: 'kyc-scenario-sole-nonfood',
        businessName: 'KYC Scenario Sole NonFood',
        entityType: 'SOLE_PROPRIETORSHIP',
        status: 'PENDING',
        categoryIds: [nonFoodId],
      },
      {
        slug: 'kyc-scenario-llp-food',
        businessName: 'KYC Scenario LLP Food',
        entityType: 'LLP',
        status: 'PENDING',
        categoryIds: [foodId],
      },
      {
        slug: 'kyc-scenario-approved-add-food',
        businessName: 'KYC Scenario Approved Add Food',
        entityType: 'SOLE_PROPRIETORSHIP',
        status: 'APPROVED',
        categoryIds: [nonFoodId, foodId],
        seedVerifiedBaseDocs: true,
        seedProducts: true,
      },
    ];

    for (const scenario of scenarios) {
      const vendorId = uuidv4();
      await queryInterface.bulkInsert('vendors', [
        {
          id: vendorId,
          businessName: scenario.businessName,
          slug: scenario.slug,
          gstNumber: null,
          state: 'KA',
          entityType: scenario.entityType,
          bankDetails: JSON.stringify({ seed: SEED_TAG }),
          logoUrl: null,
          bannerUrl: null,
          description: SEED_TAG,
          status: scenario.status,
          rejectionReason: null,
          suspensionReason: null,
          commissionRate: 10,
          performanceScore: 0,
          returnShippingFee: null,
          createdBy: null,
          updatedBy: null,
          deletedBy: null,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        },
      ]);

      for (const categoryId of scenario.categoryIds) {
        await queryInterface.bulkInsert('vendor_categories', [
          {
            id: uuidv4(),
            vendorId,
            categoryId,
            createdBy: null,
            updatedBy: null,
            deletedBy: null,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
          },
        ]);
      }

      if (scenario.seedVerifiedBaseDocs) {
        for (const type of BASE_DOC_TYPES) {
          await queryInterface.bulkInsert('vendor_documents', [
            {
              id: uuidv4(),
              vendorId,
              type,
              url: `https://example.com/kyc/${scenario.slug}/${type}.pdf`,
              verified: true,
              verifiedById: null,
              rejectionReason: null,
              rejectedAt: null,
              createdBy: null,
              updatedBy: null,
              deletedBy: null,
              createdAt: now,
              updatedAt: now,
              deletedAt: null,
            },
          ]);
        }
      }

      if (scenario.seedProducts) {
        await queryInterface.bulkInsert('products', [
          {
            id: uuidv4(),
            vendorId,
            categoryId: nonFoodId,
            name: 'KYC Scenario NonFood Live',
            slug: 'kyc-scenario-nonfood-live',
            description: 'Existing LIVE non-food product — must remain unaffected',
            basePrice: 199.0,
            status: 'LIVE',
            approvedById: null,
            rejectionNote: null,
            avgRating: 0,
            createdBy: null,
            updatedBy: null,
            deletedBy: null,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
          },
          {
            id: uuidv4(),
            vendorId,
            categoryId: foodId,
            name: 'KYC Scenario Food Draft',
            slug: 'kyc-scenario-food-draft',
            description: 'Food DRAFT — submit/LIVE blocked until FSSAI verified',
            basePrice: 99.0,
            status: 'DRAFT',
            approvedById: null,
            rejectionNote: null,
            avgRating: 0,
            createdBy: null,
            updatedBy: null,
            deletedBy: null,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
          },
        ]);
      }
    }
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      `DELETE FROM products WHERE slug LIKE 'kyc-scenario-%'`,
    );
    await queryInterface.sequelize.query(
      `DELETE FROM vendor_documents WHERE "vendorId" IN (
         SELECT id FROM vendors WHERE slug LIKE 'kyc-scenario-%'
       )`,
    );
    await queryInterface.sequelize.query(
      `DELETE FROM vendor_categories WHERE "vendorId" IN (
         SELECT id FROM vendors WHERE slug LIKE 'kyc-scenario-%'
       )`,
    );
    await queryInterface.sequelize.query(
      `DELETE FROM vendors WHERE slug LIKE 'kyc-scenario-%'`,
    );
  },
};

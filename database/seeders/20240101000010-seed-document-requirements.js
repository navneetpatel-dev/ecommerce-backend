'use strict';

const { v4: uuidv4 } = require('uuid');

/**
 * Seeds DocumentRequirement rows.
 * Food / regulated categories are resolved by slug so UUIDs stay stable across environments.
 * Food is ensured (created if missing) the same way as liquor/pharma/fireworks.
 */

const UNIVERSAL_TYPES = [
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
        displayOrder: slug === 'food' ? 100 : 900,
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
    const rows = [];

    for (const documentType of UNIVERSAL_TYPES) {
      rows.push({
        id: uuidv4(),
        entityType: null,
        categoryId: null,
        documentType,
        isMandatory: true,
        createdAt: now,
        updatedAt: now,
      });
    }

    for (const entityType of ['PARTNERSHIP', 'LLP']) {
      rows.push({
        id: uuidv4(),
        entityType,
        categoryId: null,
        documentType: 'PARTNERSHIP_DEED',
        isMandatory: true,
        createdAt: now,
        updatedAt: now,
      });
    }

    rows.push({
      id: uuidv4(),
      entityType: 'PRIVATE_LIMITED',
      categoryId: null,
      documentType: 'INCORPORATION_CERT',
      isMandatory: true,
      createdAt: now,
      updatedAt: now,
    });

    const foodId = await ensureCategoryBySlug(queryInterface, 'food', now);
    rows.push({
      id: uuidv4(),
      entityType: null,
      categoryId: foodId,
      documentType: 'FSSAI_LICENSE',
      isMandatory: true,
      createdAt: now,
      updatedAt: now,
    });

    for (const slug of ['liquor', 'pharma', 'fireworks']) {
      const categoryId = await ensureCategoryBySlug(queryInterface, slug, now);
      rows.push({
        id: uuidv4(),
        entityType: null,
        categoryId,
        documentType: 'CATEGORY_TRADE_LICENSE',
        isMandatory: true,
        createdAt: now,
        updatedAt: now,
      });
    }

    if (rows.length > 0) {
      await queryInterface.bulkInsert('document_requirements', rows);
    }
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('document_requirements', null, {});
  },
};

'use strict';

const { assertSeedingAllowed } = require('../seedGuard');

const { randomUUID: uuidv4 } = require('node:crypto');

/**
 * Seeds DocumentRequirement rows: what every vendor uploads, what each legal entity adds, and
 * the FSSAI licence for the Food category (created here if it does not exist yet).
 */

const UNIVERSAL_TYPES = [
  'GST_CERT',
  'PAN',
  'AADHAAR',
  'BANK_PROOF',
  'ADDRESS_PROOF',
  'AUTHORIZED_SIGNATORY_ID',
];

async function ensureFoodCategory(queryInterface, now) {
  const [found] = await queryInterface.sequelize.query(
    `SELECT id FROM categories WHERE slug = 'food' AND "deletedAt" IS NULL LIMIT 1`,
  );
  if (found.length > 0) return found[0].id;
  const id = uuidv4();
  await queryInterface.bulkInsert('categories', [
    { id, name: 'Food', slug: 'food', parentId: null, status: 'ACTIVE', displayOrder: 100, createdAt: now, updatedAt: now },
  ]);
  return id;
}

module.exports = {
  async up(queryInterface) {
    assertSeedingAllowed('20240101000010-seed-document-requirements.js');
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

    rows.push({
      id: uuidv4(),
      entityType: null,
      categoryId: await ensureFoodCategory(queryInterface, now),
      documentType: 'FSSAI_LICENSE',
      isMandatory: true,
      createdAt: now,
      updatedAt: now,
    });

    if (rows.length > 0) {
      await queryInterface.bulkInsert('document_requirements', rows);
    }
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('document_requirements', null, {});
  },
};

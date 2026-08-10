'use strict';

/**
 * Backfill missing/unverified universal KYC documents for APPROVED vendors.
 * Needed after DocumentRequirement expanded the base set beyond GST/PAN/BANK_PROOF
 * so existing demo/catalog vendors can still submit/update LIVE non-food products.
 *
 * Safe to re-run:
 * - inserts missing base types as verified
 * - marks existing unverified base types as verified for APPROVED vendors only
 */

const { v4: uuidv4 } = require('uuid');

const BASE_DOC_TYPES = [
  'GST_CERT',
  'PAN',
  'AADHAAR',
  'BANK_PROOF',
  'ADDRESS_PROOF',
  'AUTHORIZED_SIGNATORY_ID',
];

module.exports = {
  async up(queryInterface) {
    const now = new Date();
    const [vendors] = await queryInterface.sequelize.query(
      `SELECT id, slug FROM vendors
       WHERE status = 'APPROVED' AND "deletedAt" IS NULL`,
    );

    if (!vendors.length) return;

    const rows = [];
    for (const vendor of vendors) {
      const [existing] = await queryInterface.sequelize.query(
        `SELECT id, type, verified FROM vendor_documents
         WHERE "vendorId" = :vendorId AND "deletedAt" IS NULL`,
        { replacements: { vendorId: vendor.id } },
      );
      const byType = new Map(existing.map((row) => [row.type, row]));

      for (const type of BASE_DOC_TYPES) {
        const current = byType.get(type);
        if (!current) {
          rows.push({
            id: uuidv4(),
            vendorId: vendor.id,
            type,
            url: `https://docs.example.com/backfill/${type.toLowerCase()}_${vendor.slug || vendor.id}.pdf`,
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
          });
          continue;
        }
        if (!current.verified) {
          await queryInterface.sequelize.query(
            `UPDATE vendor_documents
             SET verified = true,
                 "rejectionReason" = NULL,
                 "rejectedAt" = NULL,
                 "updatedAt" = :now
             WHERE id = :id`,
            { replacements: { id: current.id, now } },
          );
        }
      }
    }

    if (rows.length > 0) {
      await queryInterface.bulkInsert('vendor_documents', rows);
    }
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      `DELETE FROM vendor_documents
       WHERE url LIKE 'https://docs.example.com/backfill/%'`,
    );
  },
};

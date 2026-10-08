'use strict';

const { assertSeedingAllowed } = require('../seedGuard');

/**
 * Backfill missing/unverified universal KYC documents for APPROVED vendors.
 * Needed after DocumentRequirement expanded the base set beyond GST/PAN/BANK_PROOF
 * so existing demo/catalog vendors can still submit/update LIVE non-food products.
 *
 * Then re-derive `vendors.kycVerified` for every vendor from those documents.
 * That flag gates the whole customer-facing catalog (Product scope
 * 'customerVisible', search, vendor directory): the app only refreshes it from
 * document/vendor events, so seeders that insert verified documents directly
 * otherwise leave every seeded vendor flagged unverified — guests then get an
 * empty catalog while admins/vendors (unscoped queries) see every product.
 *
 * Safe to re-run:
 * - inserts missing base types as verified
 * - marks existing unverified base types as verified for APPROVED vendors only
 * - recomputes vendors.kycVerified (same rule as resolveRequiredDocuments)
 */

const { v4: uuidv4 } = require('uuid');

const BASE_DOC_TYPES = ['GST_CERT', 'PAN', 'AADHAAR', 'BANK_PROOF', 'ADDRESS_PROOF', 'AUTHORIZED_SIGNATORY_ID'];

module.exports = {
  async up(queryInterface) {
    assertSeedingAllowed('20240101000012-backfill-approved-vendor-base-kyc.js');
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

    // Re-derive the sellable flag from the documents + requirements that now exist.
    // Mirrors the vendor-kyc-gate migration and resolveRequiredDocuments(): a vendor is
    // verified only when every mandatory document for its entity type and category
    // closure is verified (category/entity rules, else the universal base set).
    await queryInterface.sequelize.query(`
      WITH RECURSIVE vendor_cats AS (
        SELECT vc."vendorId", c.id, c."parentId"
        FROM vendor_categories vc
        INNER JOIN categories c ON c.id = vc."categoryId"
        WHERE vc."deletedAt" IS NULL
        UNION
        SELECT vcats."vendorId", p.id, p."parentId"
        FROM vendor_cats vcats
        INNER JOIN categories p ON p.id = vcats."parentId"
      ),
      matched AS (
        SELECT DISTINCT v.id AS "vendorId", dr."documentType"::text AS type
        FROM vendors v
        INNER JOIN document_requirements dr
          ON dr."deletedAt" IS NULL
          AND dr."isMandatory" = true
          AND (
            (dr."entityType" IS NULL AND dr."categoryId" IS NULL)
            OR (dr."entityType"::text = v."entityType"::text AND dr."categoryId" IS NULL)
            OR dr."categoryId" IN (SELECT vc.id FROM vendor_cats vc WHERE vc."vendorId" = v.id)
          )
      ),
      required AS (
        SELECT "vendorId", type FROM matched
        UNION ALL
        -- No rules seeded for the vendor: the universal base set (as the app falls back).
        SELECT v.id, base.type
        FROM vendors v
        CROSS JOIN (VALUES ('GST_CERT'), ('PAN'), ('AADHAAR'), ('BANK_PROOF'),
                           ('ADDRESS_PROOF'), ('AUTHORIZED_SIGNATORY_ID')) AS base(type)
        WHERE NOT EXISTS (SELECT 1 FROM matched m WHERE m."vendorId" = v.id)
      )
      UPDATE vendors v
      SET "kycVerified" = NOT EXISTS (
        SELECT 1 FROM required r
        WHERE r."vendorId" = v.id
          AND NOT EXISTS (
            SELECT 1 FROM vendor_documents d
            WHERE d."vendorId" = v.id
              AND d.type::text = r.type
              AND d.verified = true
              AND d."deletedAt" IS NULL
          )
      )
      WHERE v."deletedAt" IS NULL
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      `DELETE FROM vendor_documents
       WHERE url LIKE 'https://docs.example.com/backfill/%'`,
    );
  },
};

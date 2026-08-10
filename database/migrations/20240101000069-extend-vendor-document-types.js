'use strict';

const NEW_TYPES = [
  'AADHAAR',
  'ADDRESS_PROOF',
  'INCORPORATION_CERT',
  'PARTNERSHIP_DEED',
  'AUTHORIZED_SIGNATORY_ID',
  'FSSAI_LICENSE',
  'CATEGORY_TRADE_LICENSE',
];

/** Extends vendor_documents.type enum for full KYC document set. */
module.exports = {
  async up(queryInterface) {
    for (const value of NEW_TYPES) {
      await queryInterface.sequelize.query(
        `ALTER TYPE "enum_vendor_documents_type" ADD VALUE IF NOT EXISTS '${value}'`,
      );
    }
  },

  async down() {
    // Postgres cannot easily remove enum values; leave extended values in place.
  },
};

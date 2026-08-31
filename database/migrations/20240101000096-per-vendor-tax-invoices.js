'use strict';

/**
 * Per-vendor GST tax invoice numbering:
 * - vendor_invoice_sequences (FY-scoped BIGINT counters)
 * - sub_orders.taxInvoiceNumber / taxInvoiceIssuedAt
 * - vendors.invoicePrefix (optional override)
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const names = await queryInterface.showAllTables();

    if (!names.includes('vendor_invoice_sequences')) {
      await queryInterface.createTable('vendor_invoice_sequences', {
        id: {
          type: Sequelize.UUID,
          defaultValue: Sequelize.UUIDV4,
          primaryKey: true,
        },
        vendorId: {
          type: Sequelize.UUID,
          allowNull: true,
          references: { model: 'vendors', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        financialYear: { type: Sequelize.STRING(9), allowNull: false },
        nextValue: {
          type: Sequelize.BIGINT,
          allowNull: false,
          defaultValue: 1,
        },
        prefix: { type: Sequelize.STRING(16), allowNull: false },
        createdAt: { type: Sequelize.DATE, allowNull: false },
        updatedAt: { type: Sequelize.DATE, allowNull: false },
      });

      // Partial unique: one sequence row per (vendor, FY); NULL vendorId = platform
      await queryInterface.sequelize.query(`
        CREATE UNIQUE INDEX vendor_invoice_sequences_vendor_fy_uidx
        ON vendor_invoice_sequences ("vendorId", "financialYear")
        WHERE "vendorId" IS NOT NULL;
      `);
      await queryInterface.sequelize.query(`
        CREATE UNIQUE INDEX vendor_invoice_sequences_platform_fy_uidx
        ON vendor_invoice_sequences ("financialYear")
        WHERE "vendorId" IS NULL;
      `);
    }

    const vendorCols = await queryInterface.describeTable('vendors');
    if (!vendorCols.invoicePrefix) {
      await queryInterface.addColumn('vendors', 'invoicePrefix', {
        type: Sequelize.STRING(16),
        allowNull: true,
      });
    }

    const subCols = await queryInterface.describeTable('sub_orders');
    if (!subCols.taxInvoiceNumber) {
      await queryInterface.addColumn('sub_orders', 'taxInvoiceNumber', {
        type: Sequelize.STRING(64),
        allowNull: true,
        unique: true,
      });
    }
    if (!subCols.taxInvoiceIssuedAt) {
      await queryInterface.addColumn('sub_orders', 'taxInvoiceIssuedAt', {
        type: Sequelize.DATE,
        allowNull: true,
      });
    }
  },

  async down(queryInterface) {
    const subCols = await queryInterface.describeTable('sub_orders');
    if (subCols.taxInvoiceIssuedAt) {
      await queryInterface.removeColumn('sub_orders', 'taxInvoiceIssuedAt');
    }
    if (subCols.taxInvoiceNumber) {
      await queryInterface.removeColumn('sub_orders', 'taxInvoiceNumber');
    }

    const vendorCols = await queryInterface.describeTable('vendors');
    if (vendorCols.invoicePrefix) {
      await queryInterface.removeColumn('vendors', 'invoicePrefix');
    }

    const names = await queryInterface.showAllTables();
    if (names.includes('vendor_invoice_sequences')) {
      await queryInterface.dropTable('vendor_invoice_sequences');
    }
  },
};

'use strict';

/**
 * GST compliance follow-ups:
 * - Vendor-scoped CN/DN sequences (kind on vendor_invoice_sequences)
 * - Credit/debit note refs to original tax invoice + subOrder
 * - Platform commission invoices to vendors
 * - ECO TCS s.52 ledger enrichment + return adjustments
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const names = await queryInterface.showAllTables();

    // --- vendor_invoice_sequences.kind ---
    if (names.includes('vendor_invoice_sequences')) {
      const cols = await queryInterface.describeTable('vendor_invoice_sequences');
      if (!cols.kind) {
        await queryInterface.addColumn('vendor_invoice_sequences', 'kind', {
          type: Sequelize.STRING(32),
          allowNull: false,
          defaultValue: 'TAX_INVOICE',
        });
      }

      await queryInterface.sequelize.query(`
        DROP INDEX IF EXISTS vendor_invoice_sequences_vendor_fy_uidx;
      `);
      await queryInterface.sequelize.query(`
        DROP INDEX IF EXISTS vendor_invoice_sequences_platform_fy_uidx;
      `);
      await queryInterface.sequelize.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS vendor_invoice_sequences_vendor_fy_kind_uidx
        ON vendor_invoice_sequences ("vendorId", "financialYear", kind)
        WHERE "vendorId" IS NOT NULL;
      `);
      await queryInterface.sequelize.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS vendor_invoice_sequences_platform_fy_kind_uidx
        ON vendor_invoice_sequences ("financialYear", kind)
        WHERE "vendorId" IS NULL;
      `);
    }

    // --- credit_notes ---
    if (names.includes('credit_notes')) {
      const cn = await queryInterface.describeTable('credit_notes');
      if (cn.number && cn.number.type && !String(cn.number.type).includes('64')) {
        await queryInterface.changeColumn('credit_notes', 'number', {
          type: Sequelize.STRING(64),
          allowNull: false,
          unique: true,
        });
      }
      if (!cn.subOrderId) {
        await queryInterface.addColumn('credit_notes', 'subOrderId', {
          type: Sequelize.UUID,
          allowNull: true,
          references: { model: 'sub_orders', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        });
      }
      if (!cn.vendorId) {
        await queryInterface.addColumn('credit_notes', 'vendorId', {
          type: Sequelize.UUID,
          allowNull: true,
          references: { model: 'vendors', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        });
      }
      if (!cn.againstInvoiceNumber) {
        await queryInterface.addColumn('credit_notes', 'againstInvoiceNumber', {
          type: Sequelize.STRING(64),
          allowNull: true,
        });
      }
    }

    // --- debit_notes ---
    if (names.includes('debit_notes')) {
      const dn = await queryInterface.describeTable('debit_notes');
      if (dn.number) {
        await queryInterface.changeColumn('debit_notes', 'number', {
          type: Sequelize.STRING(64),
          allowNull: false,
          unique: true,
        });
      }
      if (!dn.subOrderId) {
        await queryInterface.addColumn('debit_notes', 'subOrderId', {
          type: Sequelize.UUID,
          allowNull: true,
          references: { model: 'sub_orders', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        });
      }
      if (!dn.againstInvoiceNumber) {
        await queryInterface.addColumn('debit_notes', 'againstInvoiceNumber', {
          type: Sequelize.STRING(64),
          allowNull: true,
        });
      }
    }

    // --- commission_invoices ---
    if (!names.includes('commission_invoices')) {
      await queryInterface.createTable('commission_invoices', {
        id: {
          type: Sequelize.UUID,
          defaultValue: Sequelize.UUIDV4,
          primaryKey: true,
        },
        number: { type: Sequelize.STRING(64), allowNull: false, unique: true },
        vendorId: {
          type: Sequelize.UUID,
          allowNull: false,
          references: { model: 'vendors', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        payoutId: {
          type: Sequelize.UUID,
          allowNull: true,
          references: { model: 'payouts', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        periodStart: { type: Sequelize.DATE, allowNull: false },
        periodEnd: { type: Sequelize.DATE, allowNull: false },
        taxablePaise: { type: Sequelize.BIGINT, allowNull: false, defaultValue: 0 },
        gstPaise: { type: Sequelize.BIGINT, allowNull: false, defaultValue: 0 },
        cgstPaise: { type: Sequelize.BIGINT, allowNull: false, defaultValue: 0 },
        sgstPaise: { type: Sequelize.BIGINT, allowNull: false, defaultValue: 0 },
        igstPaise: { type: Sequelize.BIGINT, allowNull: false, defaultValue: 0 },
        totalPaise: { type: Sequelize.BIGINT, allowNull: false, defaultValue: 0 },
        gstRatePercent: { type: Sequelize.DECIMAL(5, 2), allowNull: false, defaultValue: 18 },
        sacCode: { type: Sequelize.STRING(16), allowNull: false, defaultValue: '9985' },
        placeOfSupplyState: { type: Sequelize.STRING(64), allowNull: true },
        issuedAt: { type: Sequelize.DATE, allowNull: false },
        createdBy: { type: Sequelize.UUID, allowNull: true },
        updatedBy: { type: Sequelize.UUID, allowNull: true },
        deletedBy: { type: Sequelize.UUID, allowNull: true },
        createdAt: { type: Sequelize.DATE, allowNull: false },
        updatedAt: { type: Sequelize.DATE, allowNull: false },
        deletedAt: { type: Sequelize.DATE, allowNull: true },
      });
      await queryInterface.addIndex('commission_invoices', ['vendorId']);
      await queryInterface.addIndex('commission_invoices', ['payoutId']);
    }

    // --- tcs_ledgers enrichment ---
    if (names.includes('tcs_ledgers')) {
      const tcs = await queryInterface.describeTable('tcs_ledgers');
      if (!tcs.section) {
        await queryInterface.addColumn('tcs_ledgers', 'section', {
          type: Sequelize.STRING(8),
          allowNull: false,
          defaultValue: '52',
        });
      }
      if (!tcs.entryType) {
        await queryInterface.addColumn('tcs_ledgers', 'entryType', {
          type: Sequelize.STRING(32),
          allowNull: false,
          defaultValue: 'COLLECTION',
        });
      }
      if (!tcs.vendorGstin) {
        await queryInterface.addColumn('tcs_ledgers', 'vendorGstin', {
          type: Sequelize.STRING(20),
          allowNull: true,
        });
      }
      if (!tcs.placeOfSupplyState) {
        await queryInterface.addColumn('tcs_ledgers', 'placeOfSupplyState', {
          type: Sequelize.STRING(64),
          allowNull: true,
        });
      }
      if (!tcs.returnRequestId) {
        await queryInterface.addColumn('tcs_ledgers', 'returnRequestId', {
          type: Sequelize.UUID,
          allowNull: true,
          references: { model: 'return_requests', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        });
      }
    }
  },

  async down(queryInterface) {
    const names = await queryInterface.showAllTables();

    if (names.includes('tcs_ledgers')) {
      const tcs = await queryInterface.describeTable('tcs_ledgers');
      for (const col of [
        'returnRequestId',
        'placeOfSupplyState',
        'vendorGstin',
        'entryType',
        'section',
      ]) {
        if (tcs[col]) await queryInterface.removeColumn('tcs_ledgers', col);
      }
    }

    if (names.includes('commission_invoices')) {
      await queryInterface.dropTable('commission_invoices');
    }

    if (names.includes('debit_notes')) {
      const dn = await queryInterface.describeTable('debit_notes');
      if (dn.againstInvoiceNumber) {
        await queryInterface.removeColumn('debit_notes', 'againstInvoiceNumber');
      }
      if (dn.subOrderId) await queryInterface.removeColumn('debit_notes', 'subOrderId');
    }

    if (names.includes('credit_notes')) {
      const cn = await queryInterface.describeTable('credit_notes');
      if (cn.againstInvoiceNumber) {
        await queryInterface.removeColumn('credit_notes', 'againstInvoiceNumber');
      }
      if (cn.vendorId) await queryInterface.removeColumn('credit_notes', 'vendorId');
      if (cn.subOrderId) await queryInterface.removeColumn('credit_notes', 'subOrderId');
    }

    if (names.includes('vendor_invoice_sequences')) {
      await queryInterface.sequelize.query(`
        DROP INDEX IF EXISTS vendor_invoice_sequences_vendor_fy_kind_uidx;
      `);
      await queryInterface.sequelize.query(`
        DROP INDEX IF EXISTS vendor_invoice_sequences_platform_fy_kind_uidx;
      `);
      const cols = await queryInterface.describeTable('vendor_invoice_sequences');
      if (cols.kind) await queryInterface.removeColumn('vendor_invoice_sequences', 'kind');
      await queryInterface.sequelize.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS vendor_invoice_sequences_vendor_fy_uidx
        ON vendor_invoice_sequences ("vendorId", "financialYear")
        WHERE "vendorId" IS NOT NULL;
      `);
      await queryInterface.sequelize.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS vendor_invoice_sequences_platform_fy_uidx
        ON vendor_invoice_sequences ("financialYear")
        WHERE "vendorId" IS NULL;
      `);
    }
  },
};

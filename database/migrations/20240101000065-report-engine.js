'use strict';

/**
 * Report engine schema:
 * - report_export_logs (audit + async export status)
 * - tcs_ledgers: CGST/SGST/IGST split + period
 * - tds_ledgers: payoutId, section 194O, period
 * - credit_notes / debit_notes: reason + issuedAt
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('report_export_logs', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      userId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
      },
      reportType: { type: Sequelize.STRING(64), allowNull: false },
      filtersUsed: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      format: { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'xlsx' },
      status: {
        type: Sequelize.ENUM('SYNC', 'PENDING', 'READY', 'FAILED'),
        allowNull: false,
        defaultValue: 'SYNC',
      },
      rowCount: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      fileKey: { type: Sequelize.STRING(512), allowNull: true },
      fileUrl: { type: Sequelize.STRING(1024), allowNull: true },
      errorMessage: { type: Sequelize.TEXT, allowNull: true },
      exportedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      createdBy: { type: Sequelize.UUID, allowNull: true },
      updatedBy: { type: Sequelize.UUID, allowNull: true },
      deletedBy: { type: Sequelize.UUID, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      deletedAt: { type: Sequelize.DATE, allowNull: true },
    });
    await queryInterface.addIndex('report_export_logs', ['userId', 'exportedAt']);
    await queryInterface.addIndex('report_export_logs', ['reportType']);

    const tcs = await queryInterface.describeTable('tcs_ledgers');
    if (!tcs.tcsCgstPaise) {
      await queryInterface.addColumn('tcs_ledgers', 'tcsCgstPaise', {
        type: Sequelize.BIGINT,
        allowNull: false,
        defaultValue: 0,
      });
    }
    if (!tcs.tcsSgstPaise) {
      await queryInterface.addColumn('tcs_ledgers', 'tcsSgstPaise', {
        type: Sequelize.BIGINT,
        allowNull: false,
        defaultValue: 0,
      });
    }
    if (!tcs.tcsIgstPaise) {
      await queryInterface.addColumn('tcs_ledgers', 'tcsIgstPaise', {
        type: Sequelize.BIGINT,
        allowNull: false,
        defaultValue: 0,
      });
    }
    if (!tcs.period) {
      await queryInterface.addColumn('tcs_ledgers', 'period', {
        type: Sequelize.STRING(7),
        allowNull: true,
      });
    }

    const tds = await queryInterface.describeTable('tds_ledgers');
    if (!tds.payoutId) {
      await queryInterface.addColumn('tds_ledgers', 'payoutId', {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'payouts', key: 'id' },
        onDelete: 'SET NULL',
      });
    }
    if (!tds.section) {
      await queryInterface.addColumn('tds_ledgers', 'section', {
        type: Sequelize.STRING(16),
        allowNull: false,
        defaultValue: '194O',
      });
    }
    if (!tds.period) {
      await queryInterface.addColumn('tds_ledgers', 'period', {
        type: Sequelize.STRING(7),
        allowNull: true,
      });
    }

    // Backfill period from createdAt
    await queryInterface.sequelize.query(`
      UPDATE tcs_ledgers
      SET period = to_char("createdAt", 'YYYY-MM')
      WHERE period IS NULL
    `);
    await queryInterface.sequelize.query(`
      UPDATE tds_ledgers
      SET period = to_char("createdAt", 'YYYY-MM')
      WHERE period IS NULL
    `);

    // Conservative TCS split: if SubOrder tax is IGST-dominant → all TCS as IGST, else half CGST/SGST
    await queryInterface.sequelize.query(`
      UPDATE tcs_ledgers t
      SET
        "tcsIgstPaise" = CASE
          WHEN COALESCE((s."taxBreakdown"->>'igst')::numeric, 0) >
               COALESCE((s."taxBreakdown"->>'cgst')::numeric, 0) + COALESCE((s."taxBreakdown"->>'sgst')::numeric, 0)
          THEN t."tcsAmountPaise"
          ELSE 0
        END,
        "tcsCgstPaise" = CASE
          WHEN COALESCE((s."taxBreakdown"->>'igst')::numeric, 0) >
               COALESCE((s."taxBreakdown"->>'cgst')::numeric, 0) + COALESCE((s."taxBreakdown"->>'sgst')::numeric, 0)
          THEN 0
          ELSE FLOOR(t."tcsAmountPaise" / 2)
        END,
        "tcsSgstPaise" = CASE
          WHEN COALESCE((s."taxBreakdown"->>'igst')::numeric, 0) >
               COALESCE((s."taxBreakdown"->>'cgst')::numeric, 0) + COALESCE((s."taxBreakdown"->>'sgst')::numeric, 0)
          THEN 0
          ELSE t."tcsAmountPaise" - FLOOR(t."tcsAmountPaise" / 2)
        END
      FROM sub_orders s
      WHERE s.id = t."subOrderId"
        AND t."tcsCgstPaise" = 0 AND t."tcsSgstPaise" = 0 AND t."tcsIgstPaise" = 0
        AND t."tcsAmountPaise" > 0
    `);

    const cn = await queryInterface.describeTable('credit_notes');
    if (!cn.reason) {
      await queryInterface.addColumn('credit_notes', 'reason', {
        type: Sequelize.TEXT,
        allowNull: true,
      });
    }
    if (!cn.issuedAt) {
      await queryInterface.addColumn('credit_notes', 'issuedAt', {
        type: Sequelize.DATE,
        allowNull: true,
      });
    }
    const dn = await queryInterface.describeTable('debit_notes');
    if (!dn.reason) {
      await queryInterface.addColumn('debit_notes', 'reason', {
        type: Sequelize.TEXT,
        allowNull: true,
      });
    }
    if (!dn.issuedAt) {
      await queryInterface.addColumn('debit_notes', 'issuedAt', {
        type: Sequelize.DATE,
        allowNull: true,
      });
    }
    await queryInterface.sequelize.query(`
      UPDATE credit_notes SET "issuedAt" = "createdAt" WHERE "issuedAt" IS NULL
    `);
    await queryInterface.sequelize.query(`
      UPDATE debit_notes SET "issuedAt" = "createdAt" WHERE "issuedAt" IS NULL
    `);
  },

  async down(queryInterface) {
    const dropCols = async (table, cols) => {
      const desc = await queryInterface.describeTable(table);
      for (const col of cols) {
        if (desc[col]) await queryInterface.removeColumn(table, col);
      }
    };
    await dropCols('credit_notes', ['reason', 'issuedAt']);
    await dropCols('debit_notes', ['reason', 'issuedAt']);
    await dropCols('tds_ledgers', ['payoutId', 'section', 'period']);
    await dropCols('tcs_ledgers', ['tcsCgstPaise', 'tcsSgstPaise', 'tcsIgstPaise', 'period']);
    await queryInterface.dropTable('report_export_logs');
  },
};

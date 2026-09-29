'use strict';

/**
 * - payouts: what each payout is made of — the sale ledgers' net (gross), 194-O TDS,
 *   GST on commission, and adjustment rows (cashback costs, returns after payout) —
 *   so a vendor's payout statement reconciles to the amount paid. Existing payouts are
 *   backfilled from their TDS rows and commission documents; their adjustments are
 *   unknown and left at 0 (gross = amount + TDS + GST).
 * - tds_ledgers: a 194-O catch-up row (TDS on a sole proprietor's earlier exempt sales
 *   once the year's sales cross the limit) belongs to a payout, not to one order.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const bigint = { type: Sequelize.BIGINT, allowNull: false, defaultValue: 0 };
    await queryInterface.addColumn('payouts', 'grossPaise', bigint);
    await queryInterface.addColumn('payouts', 'tdsPaise', bigint);
    await queryInterface.addColumn('payouts', 'commissionGstPaise', bigint);
    await queryInterface.addColumn('payouts', 'adjustmentPaise', bigint);
    await queryInterface.sequelize.query(`
      UPDATE payouts p SET
        "tdsPaise" = COALESCE((SELECT SUM(t."tdsAmountPaise") FROM tds_ledgers t
                               WHERE t."payoutId" = p.id AND t."deletedAt" IS NULL), 0),
        "commissionGstPaise" = COALESCE((SELECT SUM(ci."gstPaise") FROM commission_invoices ci
                                         WHERE ci."payoutId" = p.id AND ci."deletedAt" IS NULL), 0)
    `);
    await queryInterface.sequelize.query(`
      UPDATE payouts SET "grossPaise" = ROUND(amount * 100) + "tdsPaise" + "commissionGstPaise"
    `);
    await queryInterface.changeColumn('tds_ledgers', 'orderId', { type: Sequelize.UUID, allowNull: true });
    await queryInterface.changeColumn('tds_ledgers', 'subOrderId', { type: Sequelize.UUID, allowNull: true });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('payouts', 'adjustmentPaise');
    await queryInterface.removeColumn('payouts', 'commissionGstPaise');
    await queryInterface.removeColumn('payouts', 'tdsPaise');
    await queryInterface.removeColumn('payouts', 'grossPaise');
    await queryInterface.changeColumn('tds_ledgers', 'orderId', { type: Sequelize.UUID, allowNull: false });
    await queryInterface.changeColumn('tds_ledgers', 'subOrderId', { type: Sequelize.UUID, allowNull: false });
  },
};

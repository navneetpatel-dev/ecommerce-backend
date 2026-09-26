'use strict';

/**
 * A vendor's net payout now includes the GST the customer paid: the vendor is the
 * supplier on the tax invoice and remits that GST (pricing.engine lineNetPayoutPaise).
 *
 * Recompute the net from its stored parts for everything not yet paid out: sale
 * ledgers still PENDING, plus their sub-orders and order lines. Settled ledgers were
 * paid on the old net and stay as they were, so reports match what was paid.
 */

const PENDING_SALE_LEDGER = `cl."referenceType" IS NULL AND cl.status = 'PENDING' AND cl."deletedAt" IS NULL`;

function netSql(withTax) {
  const tax = withTax ? ' + "taxAmountPaise"' : '';
  return `GREATEST(0, "taxableAmountPaise"${tax} - "commissionAmountPaise" - "tcsAmountPaise")`;
}

async function recompute(queryInterface, withTax) {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await queryInterface.sequelize.query(
      `UPDATE order_items AS oi SET "netPayoutAmountPaise" = ${netSql(withTax).replace(/"(\w+Paise)"/g, 'oi."$1"')}
       FROM commission_ledgers AS cl
       WHERE cl."subOrderId" = oi."subOrderId" AND ${PENDING_SALE_LEDGER}`,
      { transaction },
    );
    await queryInterface.sequelize.query(
      `UPDATE sub_orders AS s SET "netPayoutAmountPaise" = ${netSql(withTax).replace(/"(\w+Paise)"/g, 's."$1"')}
       FROM commission_ledgers AS cl
       WHERE cl."subOrderId" = s.id AND ${PENDING_SALE_LEDGER}`,
      { transaction },
    );
    await queryInterface.sequelize.query(
      `UPDATE commission_ledgers AS cl SET "netPayoutAmountPaise" = ${netSql(withTax).replace(/"(\w+Paise)"/g, 'cl."$1"')}
       WHERE ${PENDING_SALE_LEDGER}`,
      { transaction },
    );
  });
}

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await recompute(queryInterface, true);
  },

  async down(queryInterface) {
    await recompute(queryInterface, false);
  },
};

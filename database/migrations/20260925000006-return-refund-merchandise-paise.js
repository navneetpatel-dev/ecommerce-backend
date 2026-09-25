'use strict';

/**
 * Store a return's merchandise refund in paise, as the plan for it asked
 * (refundMerchandiseAmountPaise), and retire the rupee column the same way
 * 20260925000005 did for sub_orders, order_items and commission_ledgers.
 *
 * NULL still means "not approved yet": the engine writes the value when a return is
 * approved, together with refundAmount. The model exposes `refundMerchandiseAmount`
 * as a value derived from paise, so the returns APIs keep their shape.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.addColumn(
        'return_requests',
        'refundMerchandiseAmountPaise',
        { type: Sequelize.BIGINT, allowNull: true },
        { transaction },
      );
      await queryInterface.sequelize.query(
        `UPDATE return_requests
         SET "refundMerchandiseAmountPaise" = ROUND("refundMerchandiseAmount"::numeric * 100)::bigint
         WHERE "refundMerchandiseAmount" IS NOT NULL`,
        { transaction },
      );
      await queryInterface.removeColumn('return_requests', 'refundMerchandiseAmount', { transaction });
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.addColumn(
        'return_requests',
        'refundMerchandiseAmount',
        { type: Sequelize.DECIMAL(10, 2), allowNull: true },
        { transaction },
      );
      await queryInterface.sequelize.query(
        `UPDATE return_requests
         SET "refundMerchandiseAmount" = "refundMerchandiseAmountPaise"::numeric / 100
         WHERE "refundMerchandiseAmountPaise" IS NOT NULL`,
        { transaction },
      );
      await queryInterface.removeColumn('return_requests', 'refundMerchandiseAmountPaise', {
        transaction,
      });
    });
  },
};

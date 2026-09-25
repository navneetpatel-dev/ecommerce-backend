'use strict';

/**
 * Index sub_orders by their parent order. Customer payments in settlement,
 * customer analytics and coupon analytics subtract each order's cancelled
 * sub-orders with a per-order lookup, and every order detail, cancel and
 * refund path already loads sub-orders by orderId — without this each lookup
 * scans the table.
 */
const INDEX_NAME = 'sub_orders_order_idx';

module.exports = {
  async up(queryInterface) {
    try {
      await queryInterface.addIndex('sub_orders', ['orderId'], { name: INDEX_NAME });
    } catch (err) {
      // Idempotent when re-run against partially migrated DBs.
      if (!String(err?.message ?? err).includes('already exists')) throw err;
    }
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('sub_orders', INDEX_NAME);
  },
};

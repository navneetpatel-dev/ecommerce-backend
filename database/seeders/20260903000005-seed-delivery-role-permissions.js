'use strict';

/**
 * No-op: this seeder duplicated role/permission grants that
 * `20240101000001-seed-roles-permissions.js` already covers in full
 * (DELIVERY_AGENT → shipment.delivery_update + return.pickup_update;
 * ADMIN_ORDER_MANAGER → delivery_agent.manage). Left in place rather than
 * deleted so environments that already recorded it as run don't error on
 * a missing file; kept as a no-op so it stays harmless going forward.
 */
module.exports = {
  async up() {},
  async down() {},
};

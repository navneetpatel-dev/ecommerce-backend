'use strict';

/**
 * Gives failures recorded before categories existed a category, judged by their message, so
 * filtering and the delivery-health check treat them correctly (a skipped test address is not
 * a sign the mail system is down).
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const set = (category, ...patterns) =>
      queryInterface.sequelize.query(
        `UPDATE "notification_logs" SET "errorCategory" = '${category}' WHERE "status" = 'FAILED' AND "errorCategory" IS NULL AND (${patterns.map((p) => `"error" ILIKE '${p}'`).join(' OR ')})`,
      );
    await set('RECIPIENT', 'Not sent: the address is on a reserved test domain%', 'Recipient email missing%', 'Marketing send blocked%');
    await set('CONFIG', 'Not delivered: the mail queue was unavailable%', '%Invalid login%Username and Password not accepted%');
    await set('TEMPORARY', 'Expired before it could be delivered%', '%Too many login attempts%', '%ETIMEDOUT%', '%ECONNRESET%');
  },

  async down() {
    // Categories are informational; nothing to undo.
  },
};

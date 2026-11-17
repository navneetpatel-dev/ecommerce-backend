'use strict';

/**
 * Email failure handling.
 *
 * - notification_logs.errorCategory classifies why an email failed (TEMPORARY, PERMANENT,
 *   RENDER, RECIPIENT, CONFIG, UNCERTAIN) so failures can be filtered and acted on.
 * - notification_logs.sendingAt marks the moment a send started. If a worker dies mid-send
 *   the next attempt can see it and avoid mailing the same person twice.
 * - email_suppressions remembers addresses that hard-bounced, so mail to them is not retried
 *   over and over. Entries expire, so a one-off misclassification heals itself.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('notification_logs', 'errorCategory', { type: Sequelize.STRING(20), allowNull: true });
    await queryInterface.addColumn('notification_logs', 'sendingAt', { type: Sequelize.DATE, allowNull: true });
    await queryInterface.addIndex('notification_logs', ['errorCategory'], { name: 'notification_logs_error_category_idx' });

    await queryInterface.createTable('email_suppressions', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      email: { type: Sequelize.STRING(255), allowNull: false, unique: true },
      reason: { type: Sequelize.TEXT, allowNull: false },
      expiresAt: { type: Sequelize.DATE, allowNull: false },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('email_suppressions');
    await queryInterface.removeIndex('notification_logs', 'notification_logs_error_category_idx');
    await queryInterface.removeColumn('notification_logs', 'sendingAt');
    await queryInterface.removeColumn('notification_logs', 'errorCategory');
  },
};

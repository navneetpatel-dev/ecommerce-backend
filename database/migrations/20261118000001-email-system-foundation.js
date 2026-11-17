'use strict';

/**
 * Email system foundation.
 *
 * - notification_logs keeps what it needs to be re-sent: the rendered-data `payload`, the
 *   `recipientEmail` (set when the recipient is not a registered user: newsletter subscribers,
 *   contact enquiries, gift-card recipients), and a delivery `attempts` counter. `userId` may be
 *   null for those recipients.
 *   Rows still PENDING from before this change have no payload and can no longer be sent
 *   (some are weeks old); they are closed as FAILED rather than left looking in-flight.
 * - newsletter_subscribers gain confirmedAt / unsubscribedAt (double opt-in). Existing
 *   subscribers are treated as already confirmed.
 * - contact_messages stores what the contact form receives.
 * - user_devices remembers the browsers a user signed in from, for new-device alerts.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.changeColumn('notification_logs', 'userId', {
      type: Sequelize.UUID,
      allowNull: true,
    });
    await queryInterface.addColumn('notification_logs', 'recipientEmail', { type: Sequelize.STRING(255), allowNull: true });
    await queryInterface.addColumn('notification_logs', 'payload', { type: Sequelize.JSONB, allowNull: true });
    await queryInterface.addColumn('notification_logs', 'attempts', { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 });
    await queryInterface.sequelize.query(
      `UPDATE "notification_logs" SET "status" = 'FAILED', "error" = 'Not delivered: the mail queue was unavailable when this was created' WHERE "status" = 'PENDING' AND "payload" IS NULL`,
    );
    await queryInterface.addIndex('notification_logs', ['status', 'createdAt'], { name: 'notification_logs_status_created_idx' });

    await queryInterface.addColumn('newsletter_subscribers', 'confirmedAt', { type: Sequelize.DATE, allowNull: true });
    await queryInterface.addColumn('newsletter_subscribers', 'unsubscribedAt', { type: Sequelize.DATE, allowNull: true });
    await queryInterface.sequelize.query('UPDATE "newsletter_subscribers" SET "confirmedAt" = "createdAt"');

    await queryInterface.createTable('contact_messages', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      userId: { type: Sequelize.UUID, allowNull: true, references: { model: 'users', key: 'id' }, onDelete: 'SET NULL' },
      name: { type: Sequelize.STRING(120), allowNull: false },
      email: { type: Sequelize.STRING(255), allowNull: false },
      topic: { type: Sequelize.STRING(60), allowNull: false },
      subject: { type: Sequelize.STRING(200), allowNull: false },
      message: { type: Sequelize.TEXT, allowNull: false },
      reference: { type: Sequelize.STRING(20), allowNull: false },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('contact_messages', ['email']);

    await queryInterface.createTable('user_devices', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      userId: { type: Sequelize.UUID, allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'CASCADE' },
      fingerprint: { type: Sequelize.STRING(64), allowNull: false },
      userAgent: { type: Sequelize.STRING(400), allowNull: true },
      ipAddress: { type: Sequelize.STRING(64), allowNull: true },
      lastSeenAt: { type: Sequelize.DATE, allowNull: false },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('user_devices', ['userId', 'fingerprint'], { unique: true });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('user_devices');
    await queryInterface.dropTable('contact_messages');
    await queryInterface.removeColumn('newsletter_subscribers', 'unsubscribedAt');
    await queryInterface.removeColumn('newsletter_subscribers', 'confirmedAt');
    await queryInterface.removeIndex('notification_logs', 'notification_logs_status_created_idx');
    await queryInterface.removeColumn('notification_logs', 'attempts');
    await queryInterface.removeColumn('notification_logs', 'payload');
    await queryInterface.removeColumn('notification_logs', 'recipientEmail');
  },
};

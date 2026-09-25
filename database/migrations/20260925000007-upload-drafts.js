'use strict';

/**
 * Tie draft uploads to the user who started them.
 *
 * Products, returns, support tickets and bug reports accept uploads under a draft
 * id (a client-generated UUID) before the record exists. Until now any user with
 * the right role could upload under any unused id, so nothing tied a draft's files
 * to its author. The first upload under a draft id now claims it here; anyone else
 * is refused. Rows also let the upload service cap new drafts per user per day,
 * and the S3 orphan cleanup prunes them once they are old.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('upload_drafts', {
      id: { type: Sequelize.UUID, primaryKey: true, defaultValue: Sequelize.literal('gen_random_uuid()') },
      entityType: { type: Sequelize.STRING(64), allowNull: false },
      entityId: { type: Sequelize.UUID, allowNull: false },
      userId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
      },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    });
    await queryInterface.addIndex('upload_drafts', ['entityType', 'entityId'], {
      name: 'upload_drafts_entity_unique',
      unique: true,
    });
    await queryInterface.addIndex('upload_drafts', ['userId', 'createdAt'], {
      name: 'upload_drafts_user_created_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('upload_drafts');
  },
};

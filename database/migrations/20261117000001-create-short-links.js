'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable(
        'short_links',
        {
          id: {
            type: Sequelize.UUID,
            defaultValue: Sequelize.literal('gen_random_uuid()'),
            primaryKey: true,
            allowNull: false,
          },
          code: {
            type: Sequelize.STRING(16),
            allowNull: false,
            unique: true,
          },
          targetUrl: {
            type: Sequelize.TEXT,
            allowNull: false,
          },
          resourceType: {
            type: Sequelize.STRING(32),
            allowNull: false,
            defaultValue: 'PRODUCT',
          },
          resourceId: {
            type: Sequelize.UUID,
            allowNull: true,
          },
          metadata: {
            type: Sequelize.JSONB,
            allowNull: true,
          },
          clicks: {
            type: Sequelize.INTEGER,
            allowNull: false,
            defaultValue: 0,
          },
          createdAt: {
            type: Sequelize.DATE,
            allowNull: false,
            defaultValue: Sequelize.fn('NOW'),
          },
          updatedAt: {
            type: Sequelize.DATE,
            allowNull: false,
            defaultValue: Sequelize.fn('NOW'),
          },
        },
        { transaction },
      );

      await queryInterface.addIndex('short_links', ['code'], {
        unique: true,
        name: 'short_links_code_unique',
        transaction,
      });

      await queryInterface.addIndex('short_links', ['resourceType', 'resourceId'], {
        name: 'short_links_resource_idx',
        transaction,
      });
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('short_links');
  },
};

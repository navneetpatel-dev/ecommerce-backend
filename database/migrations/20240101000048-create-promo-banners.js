'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('promo_banners', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        primaryKey: true,
      },
      title: { type: Sequelize.STRING, allowNull: false },
      imageUrl: { type: Sequelize.STRING, allowNull: false },
      linkType: {
        type: Sequelize.ENUM('PRODUCT', 'CATEGORY', 'VENDOR', 'URL'),
        allowNull: false,
      },
      linkTargetId: { type: Sequelize.UUID, allowNull: true },
      linkUrl: { type: Sequelize.STRING, allowNull: true },
      startDate: { type: Sequelize.DATE, allowNull: true },
      endDate: { type: Sequelize.DATE, allowNull: true },
      status: {
        type: Sequelize.ENUM('DRAFT', 'ACTIVE', 'ARCHIVED'),
        allowNull: false,
        defaultValue: 'DRAFT',
      },
      priority: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
      deletedAt: { type: Sequelize.DATE, allowNull: true },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('promo_banners');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_promo_banners_linkType";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_promo_banners_status";');
  },
};

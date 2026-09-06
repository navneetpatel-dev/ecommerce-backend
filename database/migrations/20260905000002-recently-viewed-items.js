'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    const names = tables.map((t) => (typeof t === 'string' ? t : t.tableName || t));

    if (!names.includes('recently_viewed_items')) {
      await queryInterface.createTable('recently_viewed_items', {
        id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
        userId: {
          type: Sequelize.UUID,
          allowNull: false,
          references: { model: 'users', key: 'id' },
          onDelete: 'CASCADE',
        },
        productId: {
          type: Sequelize.UUID,
          allowNull: false,
          references: { model: 'products', key: 'id' },
          onDelete: 'CASCADE',
        },
        viewedAt: { type: Sequelize.DATE, allowNull: false },
        createdAt: { type: Sequelize.DATE, allowNull: false },
        updatedAt: { type: Sequelize.DATE, allowNull: false },
      });
      await queryInterface.addIndex('recently_viewed_items', {
        unique: true,
        fields: ['userId', 'productId'],
        name: 'recently_viewed_items_user_product_unique',
      });
      await queryInterface.addIndex('recently_viewed_items', ['userId', 'viewedAt']);
    }
  },

  async down(queryInterface) {
    const tables = await queryInterface.showAllTables();
    const names = tables.map((t) => (typeof t === 'string' ? t : t.tableName || t));
    if (names.includes('recently_viewed_items')) {
      await queryInterface.dropTable('recently_viewed_items');
    }
  },
};

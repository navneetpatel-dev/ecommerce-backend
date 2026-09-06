'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    const names = tables.map((t) => (typeof t === 'string' ? t : t.tableName || t));

    if (!names.includes('stock_alerts')) {
      await queryInterface.createTable('stock_alerts', {
        id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
        userId: {
          type: Sequelize.UUID,
          allowNull: true,
          references: { model: 'users', key: 'id' },
          onDelete: 'CASCADE',
        },
        guestEmail: { type: Sequelize.STRING, allowNull: true },
        variantId: {
          type: Sequelize.UUID,
          allowNull: false,
          references: { model: 'product_variants', key: 'id' },
          onDelete: 'CASCADE',
        },
        notifiedAt: { type: Sequelize.DATE, allowNull: true },
        createdAt: { type: Sequelize.DATE, allowNull: false },
        updatedAt: { type: Sequelize.DATE, allowNull: false },
      });
      await queryInterface.addIndex('stock_alerts', ['variantId']);
      await queryInterface.addIndex('stock_alerts', {
        unique: true,
        fields: ['variantId', 'userId'],
        name: 'stock_alerts_variant_user_unique',
        where: { userId: { [Sequelize.Op.ne]: null } },
      });
      await queryInterface.addIndex('stock_alerts', {
        unique: true,
        fields: ['variantId', 'guestEmail'],
        name: 'stock_alerts_variant_guest_email_unique',
        where: { guestEmail: { [Sequelize.Op.ne]: null } },
      });
    }
  },

  async down(queryInterface) {
    const tables = await queryInterface.showAllTables();
    const names = tables.map((t) => (typeof t === 'string' ? t : t.tableName || t));
    if (names.includes('stock_alerts')) {
      await queryInterface.dropTable('stock_alerts');
    }
  },
};

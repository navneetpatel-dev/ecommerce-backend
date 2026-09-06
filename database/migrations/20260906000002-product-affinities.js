'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    const names = tables.map((t) => (typeof t === 'string' ? t : t.tableName || t));

    if (!names.includes('product_affinities')) {
      await queryInterface.createTable('product_affinities', {
        id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
        productId: {
          type: Sequelize.UUID,
          allowNull: false,
          references: { model: 'products', key: 'id' },
          onDelete: 'CASCADE',
        },
        relatedProductId: {
          type: Sequelize.UUID,
          allowNull: false,
          references: { model: 'products', key: 'id' },
          onDelete: 'CASCADE',
        },
        coOccurrenceCount: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
        score: { type: Sequelize.FLOAT, allowNull: false, defaultValue: 0 },
        computedAt: { type: Sequelize.DATE, allowNull: false },
        createdAt: { type: Sequelize.DATE, allowNull: false },
        updatedAt: { type: Sequelize.DATE, allowNull: false },
      });
      await queryInterface.addIndex('product_affinities', {
        unique: true,
        fields: ['productId', 'relatedProductId'],
        name: 'product_affinities_product_related_unique',
      });
      // Read path is "top-N related for productId, ordered by score" — index the
      // sort column alongside productId so that query doesn't need a full scan.
      await queryInterface.addIndex('product_affinities', ['productId', 'score']);
    }
  },

  async down(queryInterface) {
    const tables = await queryInterface.showAllTables();
    const names = tables.map((t) => (typeof t === 'string' ? t : t.tableName || t));
    if (names.includes('product_affinities')) {
      await queryInterface.dropTable('product_affinities');
    }
  },
};

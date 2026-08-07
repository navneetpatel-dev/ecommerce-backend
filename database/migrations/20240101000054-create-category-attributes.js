'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('category_attributes', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      categoryId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'categories', key: 'id' },
        onDelete: 'CASCADE',
      },
      name: { type: Sequelize.STRING, allowNull: false },
      type: {
        type: Sequelize.ENUM('ENUM', 'RANGE', 'BOOLEAN'),
        allowNull: false,
      },
      options: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      displayOrder: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      createdBy: { type: Sequelize.UUID, allowNull: true },
      updatedBy: { type: Sequelize.UUID, allowNull: true },
      deletedBy: { type: Sequelize.UUID, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
      deletedAt: { type: Sequelize.DATE, allowNull: true },
    });
    await queryInterface.addIndex('category_attributes', ['categoryId']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('category_attributes');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_category_attributes_type";');
  },
};

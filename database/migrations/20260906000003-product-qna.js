'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    const names = tables.map((t) => (typeof t === 'string' ? t : t.tableName || t));

    if (!names.includes('product_questions')) {
      await queryInterface.createTable('product_questions', {
        id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
        productId: {
          type: Sequelize.UUID,
          allowNull: false,
          references: { model: 'products', key: 'id' },
          onDelete: 'CASCADE',
        },
        userId: {
          type: Sequelize.UUID,
          allowNull: false,
          references: { model: 'users', key: 'id' },
          onDelete: 'RESTRICT',
        },
        question: { type: Sequelize.TEXT, allowNull: false },
        status: {
          type: Sequelize.ENUM('PENDING', 'PUBLISHED', 'REJECTED'),
          allowNull: false,
          defaultValue: 'PENDING',
        },
        createdBy: { type: Sequelize.UUID, allowNull: true },
        updatedBy: { type: Sequelize.UUID, allowNull: true },
        deletedBy: { type: Sequelize.UUID, allowNull: true },
        createdAt: { type: Sequelize.DATE, allowNull: false },
        updatedAt: { type: Sequelize.DATE, allowNull: false },
        deletedAt: { type: Sequelize.DATE, allowNull: true },
      });
      await queryInterface.addIndex('product_questions', ['productId', 'status']);
    }

    if (!names.includes('product_answers')) {
      await queryInterface.createTable('product_answers', {
        id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
        questionId: {
          type: Sequelize.UUID,
          allowNull: false,
          references: { model: 'product_questions', key: 'id' },
          onDelete: 'CASCADE',
        },
        authorId: {
          type: Sequelize.UUID,
          allowNull: false,
          references: { model: 'users', key: 'id' },
          onDelete: 'RESTRICT',
        },
        authorType: {
          type: Sequelize.ENUM('VENDOR', 'CUSTOMER'),
          allowNull: false,
        },
        answer: { type: Sequelize.TEXT, allowNull: false },
        createdBy: { type: Sequelize.UUID, allowNull: true },
        updatedBy: { type: Sequelize.UUID, allowNull: true },
        deletedBy: { type: Sequelize.UUID, allowNull: true },
        createdAt: { type: Sequelize.DATE, allowNull: false },
        updatedAt: { type: Sequelize.DATE, allowNull: false },
        deletedAt: { type: Sequelize.DATE, allowNull: true },
      });
      await queryInterface.addIndex('product_answers', ['questionId']);
    }
  },

  async down(queryInterface) {
    const tables = await queryInterface.showAllTables();
    const names = tables.map((t) => (typeof t === 'string' ? t : t.tableName || t));
    if (names.includes('product_answers')) {
      await queryInterface.dropTable('product_answers');
    }
    if (names.includes('product_questions')) {
      await queryInterface.dropTable('product_questions');
    }
  },
};

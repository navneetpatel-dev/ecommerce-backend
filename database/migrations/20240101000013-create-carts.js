'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('carts', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      userId: { type: Sequelize.UUID, unique: true, allowNull: true },
      sessionId: { type: Sequelize.STRING, unique: true, allowNull: true },
      createdBy: { type: Sequelize.UUID, allowNull: true },
      updatedBy: { type: Sequelize.UUID, allowNull: true },
      deletedBy: { type: Sequelize.UUID, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
      deletedAt: { type: Sequelize.DATE, allowNull: true },
    });
  },
  async down(queryInterface) { await queryInterface.dropTable('carts'); },
};

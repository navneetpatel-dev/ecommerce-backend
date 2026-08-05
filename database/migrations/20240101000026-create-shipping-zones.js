'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('shipping_zones', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      name: { type: Sequelize.STRING, allowNull: false },
      states: { type: Sequelize.ARRAY(Sequelize.STRING), defaultValue: [] },
      pincodePrefixes: { type: Sequelize.ARRAY(Sequelize.STRING), defaultValue: [] },
      createdBy: { type: Sequelize.UUID, allowNull: true },
      updatedBy: { type: Sequelize.UUID, allowNull: true },
      deletedBy: { type: Sequelize.UUID, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
      deletedAt: { type: Sequelize.DATE, allowNull: true },
    });
  },
  async down(queryInterface) { await queryInterface.dropTable('shipping_zones'); },
};

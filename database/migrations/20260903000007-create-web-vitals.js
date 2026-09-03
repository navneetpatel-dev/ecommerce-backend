'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('web_vitals', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      name: { type: Sequelize.STRING(16), allowNull: false },
      value: { type: Sequelize.FLOAT, allowNull: false },
      rating: { type: Sequelize.STRING(32), allowNull: true },
      path: { type: Sequelize.STRING(512), allowNull: true },
      effectiveType: { type: Sequelize.STRING(16), allowNull: true },
      userId: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
      },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('web_vitals', ['name', 'createdAt']);
    await queryInterface.addIndex('web_vitals', ['userId']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('web_vitals');
  },
};

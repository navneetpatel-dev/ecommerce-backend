'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('delivery_agents', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      userId: {
        type: Sequelize.UUID,
        allowNull: false,
        unique: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
      },
      fullName: { type: Sequelize.STRING, allowNull: false },
      phone: { type: Sequelize.STRING, allowNull: false },
      vehicleType: {
        type: Sequelize.ENUM('BIKE', 'SCOOTER', 'VAN', 'BICYCLE'),
        allowNull: false,
        defaultValue: 'BIKE',
      },
      hubOrZone: { type: Sequelize.STRING, allowNull: false },
      status: {
        type: Sequelize.ENUM('ACTIVE', 'INACTIVE', 'SUSPENDED'),
        allowNull: false,
        defaultValue: 'ACTIVE',
      },
      availableForAssignment: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      createdBy: { type: Sequelize.UUID, allowNull: true },
      updatedBy: { type: Sequelize.UUID, allowNull: true },
      deletedBy: { type: Sequelize.UUID, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
      deletedAt: { type: Sequelize.DATE, allowNull: true },
    });
    await queryInterface.addIndex('delivery_agents', ['hubOrZone']);
    await queryInterface.addIndex('delivery_agents', ['status', 'availableForAssignment']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('delivery_agents');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_delivery_agents_vehicleType";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_delivery_agents_status";');
  },
};

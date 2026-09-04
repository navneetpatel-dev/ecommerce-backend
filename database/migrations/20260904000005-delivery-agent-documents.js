'use strict';

/** Agent KYC/verification documents — mirrors vendor_documents exactly. */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('delivery_agent_documents', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      deliveryAgentId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'delivery_agents', key: 'id' },
        onDelete: 'CASCADE',
      },
      type: {
        type: Sequelize.ENUM('ID_PROOF', 'DRIVING_LICENSE', 'VEHICLE_RC', 'ADDRESS_PROOF'),
        allowNull: false,
      },
      url: { type: Sequelize.STRING, allowNull: false },
      verified: { type: Sequelize.BOOLEAN, defaultValue: false },
      verifiedById: { type: Sequelize.UUID, allowNull: true, references: { model: 'users', key: 'id' } },
      rejectionReason: { type: Sequelize.TEXT, allowNull: true },
      rejectedAt: { type: Sequelize.DATE, allowNull: true },
      createdBy: { type: Sequelize.UUID, allowNull: true },
      updatedBy: { type: Sequelize.UUID, allowNull: true },
      deletedBy: { type: Sequelize.UUID, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
      deletedAt: { type: Sequelize.DATE, allowNull: true },
    });
    await queryInterface.addIndex('delivery_agent_documents', ['deliveryAgentId']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('delivery_agent_documents');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_delivery_agent_documents_type";');
  },
};

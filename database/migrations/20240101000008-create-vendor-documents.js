'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('vendor_documents', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      vendorId: { type: Sequelize.UUID, allowNull: false, references: { model: 'vendors', key: 'id' }, onDelete: 'CASCADE' },
      type: { type: Sequelize.ENUM('GST_CERT', 'PAN', 'BANK_PROOF'), allowNull: false },
      url: { type: Sequelize.STRING, allowNull: false },
      verified: { type: Sequelize.BOOLEAN, defaultValue: false },
      createdBy: { type: Sequelize.UUID, allowNull: true },
      updatedBy: { type: Sequelize.UUID, allowNull: true },
      deletedBy: { type: Sequelize.UUID, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
      deletedAt: { type: Sequelize.DATE, allowNull: true },
    });
  },
  async down(queryInterface) { await queryInterface.dropTable('vendor_documents'); },
};

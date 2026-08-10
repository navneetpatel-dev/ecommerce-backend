'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('document_requirements', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      entityType: {
        type: Sequelize.ENUM('SOLE_PROPRIETORSHIP', 'PARTNERSHIP', 'LLP', 'PRIVATE_LIMITED'),
        allowNull: true,
      },
      categoryId: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'categories', key: 'id' },
        onDelete: 'CASCADE',
      },
      documentType: {
        type: Sequelize.ENUM(
          'GST_CERT',
          'PAN',
          'AADHAAR',
          'BANK_PROOF',
          'ADDRESS_PROOF',
          'INCORPORATION_CERT',
          'PARTNERSHIP_DEED',
          'AUTHORIZED_SIGNATORY_ID',
          'FSSAI_LICENSE',
          'CATEGORY_TRADE_LICENSE',
        ),
        allowNull: false,
      },
      isMandatory: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
      deletedAt: { type: Sequelize.DATE, allowNull: true },
    });

    await queryInterface.addIndex('document_requirements', ['entityType', 'categoryId', 'documentType'], {
      name: 'document_requirements_lookup_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('document_requirements');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_document_requirements_entityType";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_document_requirements_documentType";');
  },
};

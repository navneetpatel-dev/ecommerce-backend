'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('otp_codes', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      userId: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
      },
      channel: { type: Sequelize.ENUM('EMAIL'), allowNull: false, defaultValue: 'EMAIL' },
      purpose: {
        type: Sequelize.ENUM('LOGIN', 'DELIVERY_CONFIRMATION', 'RETURN_PICKUP_CONFIRMATION'),
        allowNull: false,
      },
      codeHash: { type: Sequelize.STRING, allowNull: false },
      expiresAt: { type: Sequelize.DATE, allowNull: false },
      consumedAt: { type: Sequelize.DATE, allowNull: true },
      attempts: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('otp_codes', ['userId', 'purpose', 'consumedAt']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('otp_codes');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_otp_codes_channel";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_otp_codes_purpose";');
  },
};

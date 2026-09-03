'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.renameColumn('payouts', 'razorpayPayoutId', 'paymentReferenceNumber');
    await queryInterface.addColumn('payouts', 'paymentMethod', {
      type: Sequelize.ENUM('NEFT', 'IMPS', 'UPI', 'RTGS', 'CHEQUE', 'CASH', 'OTHER'),
      allowNull: true,
    });
    await queryInterface.addColumn('payouts', 'paidByAdminId', {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      onDelete: 'SET NULL',
    });
    await queryInterface.addColumn('payouts', 'proofOfPaymentUrl', {
      type: Sequelize.STRING,
      allowNull: true,
    });
    await queryInterface.addColumn('payouts', 'remarks', { type: Sequelize.TEXT, allowNull: true });
    await queryInterface.addColumn('payouts', 'failureReason', { type: Sequelize.TEXT, allowNull: true });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('payouts', 'failureReason');
    await queryInterface.removeColumn('payouts', 'remarks');
    await queryInterface.removeColumn('payouts', 'proofOfPaymentUrl');
    await queryInterface.removeColumn('payouts', 'paidByAdminId');
    await queryInterface.removeColumn('payouts', 'paymentMethod');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_payouts_paymentMethod";');
    await queryInterface.renameColumn('payouts', 'paymentReferenceNumber', 'razorpayPayoutId');
  },
};

'use strict';

/**
 * A parcel's code belongs to that parcel. Delivery, return-pickup and RTO-handover codes
 * were one per user and purpose: a customer's second parcel going out for delivery voided
 * the first parcel's code, and either code confirmed either parcel. `subjectId` is the
 * shipment or return a code is for (null for codes about the account, like login).
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.addColumn(
        'otp_codes',
        'subjectId',
        { type: Sequelize.UUID, allowNull: true },
        { transaction },
      );
      await queryInterface.addIndex('otp_codes', ['userId', 'purpose', 'subjectId'], {
        name: 'otp_codes_user_purpose_subject',
        transaction,
      });
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.removeIndex('otp_codes', 'otp_codes_user_purpose_subject', { transaction });
      await queryInterface.removeColumn('otp_codes', 'subjectId', { transaction });
    });
  },
};

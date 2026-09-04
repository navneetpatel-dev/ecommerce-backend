'use strict';

/** KYC document expiry tracking — an approaching/passed expiry auto-locks agent availability. */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('delivery_agent_documents', 'expiryDate', {
      type: Sequelize.DATEONLY,
      allowNull: true,
    });
    await queryInterface.addColumn('delivery_agent_documents', 'expiryReminderSentAt', {
      type: Sequelize.DATE,
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('delivery_agent_documents', 'expiryReminderSentAt');
    await queryInterface.removeColumn('delivery_agent_documents', 'expiryDate');
  },
};

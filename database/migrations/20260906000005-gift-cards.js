'use strict';

/** Gift cards: purchasable by a customer, redeemed into the existing wallet balance. */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    const names = tables.map((t) => (typeof t === 'string' ? t : t.tableName || t));
    if (!names.includes('gift_cards')) {
      await queryInterface.createTable('gift_cards', {
        id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
        code: { type: Sequelize.STRING(24), allowNull: false },
        amount: { type: Sequelize.DECIMAL(10, 2), allowNull: false },
        purchaserId: { type: Sequelize.UUID, allowNull: false },
        recipientEmail: { type: Sequelize.STRING(255), allowNull: false },
        recipientName: { type: Sequelize.STRING(255), allowNull: true },
        message: { type: Sequelize.TEXT, allowNull: true },
        redeemedByUserId: { type: Sequelize.UUID, allowNull: true },
        redeemedAt: { type: Sequelize.DATE, allowNull: true },
        expiresAt: { type: Sequelize.DATE, allowNull: false },
        status: {
          type: Sequelize.ENUM('PENDING', 'ACTIVE', 'REDEEMED', 'EXPIRED', 'CANCELLED', 'FAILED'),
          allowNull: false,
          defaultValue: 'PENDING',
        },
        razorpayOrderId: { type: Sequelize.STRING(64), allowNull: true },
        razorpayPaymentId: { type: Sequelize.STRING(64), allowNull: true },
        createdBy: { type: Sequelize.UUID, allowNull: true },
        updatedBy: { type: Sequelize.UUID, allowNull: true },
        deletedBy: { type: Sequelize.UUID, allowNull: true },
        createdAt: Sequelize.DATE,
        updatedAt: Sequelize.DATE,
        deletedAt: Sequelize.DATE,
      });
      await queryInterface.addIndex('gift_cards', ['code'], {
        unique: true,
        name: 'gift_cards_code_unique',
      });
      await queryInterface.addIndex('gift_cards', ['purchaserId']);
      await queryInterface.addIndex('gift_cards', ['redeemedByUserId']);
      await queryInterface.addIndex('gift_cards', ['razorpayOrderId'], {
        unique: true,
        where: { razorpayOrderId: { [Sequelize.Op.ne]: null } },
        name: 'gift_cards_razorpay_order_id_unique',
      });
      await queryInterface.addIndex('gift_cards', ['status', 'expiresAt']);
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable('gift_cards');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_gift_cards_status";');
  },
};

'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    const tableNames = tables.map((t) => (typeof t === 'string' ? t : t.tableName || t));

    const usersDesc = await queryInterface.describeTable('users');
    if (!usersDesc.razorpayCustomerId) {
      await queryInterface.addColumn('users', 'razorpayCustomerId', {
        type: Sequelize.STRING,
        allowNull: true,
      });
    }

    if (!tableNames.includes('saved_payment_methods')) {
      await queryInterface.createTable('saved_payment_methods', {
        id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
        userId: {
          type: Sequelize.UUID,
          allowNull: false,
          references: { model: 'users', key: 'id' },
          onDelete: 'CASCADE',
        },
        razorpayCustomerId: { type: Sequelize.STRING, allowNull: false },
        razorpayTokenId: { type: Sequelize.STRING, allowNull: false },
        methodType: { type: Sequelize.STRING, allowNull: false },
        cardLast4: { type: Sequelize.STRING(4), allowNull: true },
        cardNetwork: { type: Sequelize.STRING, allowNull: true },
        vpa: { type: Sequelize.STRING, allowNull: true },
        metadata: { type: Sequelize.JSONB, allowNull: true },
        createdAt: { type: Sequelize.DATE, allowNull: false },
      });

      await queryInterface.addIndex('saved_payment_methods', {
        unique: true,
        fields: ['razorpayTokenId'],
        name: 'saved_payment_methods_token_unique',
      });
      await queryInterface.addIndex('saved_payment_methods', ['userId']);
    }
  },

  async down(queryInterface) {
    const tables = await queryInterface.showAllTables();
    const tableNames = tables.map((t) => (typeof t === 'string' ? t : t.tableName || t));
    if (tableNames.includes('saved_payment_methods')) {
      await queryInterface.dropTable('saved_payment_methods');
    }

    const usersDesc = await queryInterface.describeTable('users');
    if (usersDesc.razorpayCustomerId) {
      await queryInterface.removeColumn('users', 'razorpayCustomerId');
    }
  },
};

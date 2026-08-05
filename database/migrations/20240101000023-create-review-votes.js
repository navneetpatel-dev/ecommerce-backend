'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('review_votes', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      reviewId: { type: Sequelize.UUID, allowNull: false, references: { model: 'reviews', key: 'id' }, onDelete: 'CASCADE' },
      userId: { type: Sequelize.UUID, allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'CASCADE' },
      vote: { type: Sequelize.ENUM('HELPFUL', 'UNHELPFUL'), allowNull: false },
      createdBy: { type: Sequelize.UUID, allowNull: true },
      updatedBy: { type: Sequelize.UUID, allowNull: true },
      deletedBy: { type: Sequelize.UUID, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
      deletedAt: { type: Sequelize.DATE, allowNull: true },
    });
    await queryInterface.addIndex('review_votes', { unique: true, fields: ['reviewId', 'userId'] });
  },
  async down(queryInterface) { await queryInterface.dropTable('review_votes'); },
};

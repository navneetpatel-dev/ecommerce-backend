'use strict';

const { v4: uuidv4 } = require('uuid');

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('support_tickets', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      ticketNumber: { type: Sequelize.STRING(32), allowNull: false, unique: true },
      customerId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'RESTRICT',
      },
      subject: { type: Sequelize.STRING(255), allowNull: false },
      description: { type: Sequelize.TEXT, allowNull: false },
      category: {
        type: Sequelize.ENUM('ORDER', 'PRODUCT', 'PAYMENT', 'VENDOR', 'OTHER'),
        allowNull: false,
      },
      relatedOrderId: { type: Sequelize.UUID, allowNull: true },
      relatedVendorId: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'vendors', key: 'id' },
        onDelete: 'SET NULL',
      },
      priority: {
        type: Sequelize.ENUM('LOW', 'MEDIUM', 'HIGH', 'URGENT'),
        allowNull: false,
        defaultValue: 'MEDIUM',
      },
      status: {
        type: Sequelize.ENUM('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'REOPENED'),
        allowNull: false,
        defaultValue: 'OPEN',
      },
      assignedToId: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
      },
      firstResponseAt: { type: Sequelize.DATE, allowNull: true },
      resolvedAt: { type: Sequelize.DATE, allowNull: true },
      closedAt: { type: Sequelize.DATE, allowNull: true },
      customerSatisfactionRating: { type: Sequelize.INTEGER, allowNull: true },
      createdBy: { type: Sequelize.UUID, allowNull: true },
      updatedBy: { type: Sequelize.UUID, allowNull: true },
      deletedBy: { type: Sequelize.UUID, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
      deletedAt: { type: Sequelize.DATE, allowNull: true },
    });

    await queryInterface.addIndex('support_tickets', ['customerId', 'status'], {
      name: 'support_tickets_customer_status_idx',
    });
    await queryInterface.addIndex('support_tickets', ['relatedVendorId', 'status'], {
      name: 'support_tickets_vendor_status_idx',
    });
    await queryInterface.addIndex('support_tickets', ['status', 'priority', 'createdAt'], {
      name: 'support_tickets_status_priority_created_idx',
    });
    await queryInterface.sequelize.query(`
      CREATE INDEX support_tickets_active_status_created_idx
      ON support_tickets (status, "createdAt")
      WHERE status NOT IN ('CLOSED') AND "deletedAt" IS NULL
    `);

    await queryInterface.createTable('ticket_messages', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      ticketId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'support_tickets', key: 'id' },
        onDelete: 'CASCADE',
      },
      senderId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'RESTRICT',
      },
      senderRole: { type: Sequelize.STRING(64), allowNull: false },
      body: { type: Sequelize.TEXT, allowNull: false },
      createdBy: { type: Sequelize.UUID, allowNull: true },
      updatedBy: { type: Sequelize.UUID, allowNull: true },
      deletedBy: { type: Sequelize.UUID, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
      deletedAt: { type: Sequelize.DATE, allowNull: true },
    });

    await queryInterface.addIndex('ticket_messages', ['ticketId', 'createdAt'], {
      name: 'ticket_messages_ticket_created_idx',
    });

    await queryInterface.createTable('ticket_attachments', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      ticketId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'support_tickets', key: 'id' },
        onDelete: 'CASCADE',
      },
      messageId: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'ticket_messages', key: 'id' },
        onDelete: 'SET NULL',
      },
      url: { type: Sequelize.STRING(1024), allowNull: false },
      type: {
        type: Sequelize.ENUM('IMAGE', 'VIDEO'),
        allowNull: false,
      },
      durationSeconds: { type: Sequelize.INTEGER, allowNull: true },
      createdBy: { type: Sequelize.UUID, allowNull: true },
      updatedBy: { type: Sequelize.UUID, allowNull: true },
      deletedBy: { type: Sequelize.UUID, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
      deletedAt: { type: Sequelize.DATE, allowNull: true },
    });

    await queryInterface.addIndex('ticket_attachments', ['ticketId'], {
      name: 'ticket_attachments_ticket_idx',
    });

    const now = new Date();
    const [existingTicketSeq] = await queryInterface.sequelize.query(
      `SELECT id FROM document_sequences WHERE kind = 'SUPPORT_TICKET' LIMIT 1`,
    );
    if (existingTicketSeq.length === 0) {
      await queryInterface.bulkInsert('document_sequences', [
        {
          id: uuidv4(),
          kind: 'SUPPORT_TICKET',
          nextValue: 1,
          prefix: 'TKT',
          createdAt: now,
          updatedAt: now,
        },
      ]);
    }

    const [existingBugSeq] = await queryInterface.sequelize.query(
      `SELECT id FROM document_sequences WHERE kind = 'BUG_REPORT' LIMIT 1`,
    );
    if (existingBugSeq.length === 0) {
      await queryInterface.bulkInsert('document_sequences', [
        {
          id: uuidv4(),
          kind: 'BUG_REPORT',
          nextValue: 1,
          prefix: 'BUG',
          createdAt: now,
          updatedAt: now,
        },
      ]);
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable('ticket_attachments');
    await queryInterface.dropTable('ticket_messages');
    await queryInterface.dropTable('support_tickets');
    await queryInterface.sequelize.query(
      `DELETE FROM document_sequences WHERE kind IN ('SUPPORT_TICKET', 'BUG_REPORT')`,
    );
    await queryInterface.sequelize.query(
      `DROP TYPE IF EXISTS "enum_support_tickets_category";`,
    ).catch(() => {});
    await queryInterface.sequelize.query(
      `DROP TYPE IF EXISTS "enum_support_tickets_priority";`,
    ).catch(() => {});
    await queryInterface.sequelize.query(
      `DROP TYPE IF EXISTS "enum_support_tickets_status";`,
    ).catch(() => {});
    await queryInterface.sequelize.query(
      `DROP TYPE IF EXISTS "enum_ticket_attachments_type";`,
    ).catch(() => {});
  },
};

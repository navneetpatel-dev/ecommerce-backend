'use strict';

const { v4: uuidv4 } = require('uuid');

const STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'REOPENED'];
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
const CATEGORIES = ['ORDER', 'PRODUCT', 'PAYMENT', 'VENDOR', 'OTHER'];

function pick(arr, index) {
  return arr[index % arr.length];
}

module.exports = {
  async up(queryInterface) {
    const [already] = await queryInterface.sequelize.query(
      `SELECT id FROM support_tickets
       WHERE subject LIKE 'Seed support ticket %' AND "deletedAt" IS NULL
       LIMIT 1`,
    );
    if (already.length > 0) {
      console.log('seed-support-tickets: already seeded — skipping');
      return;
    }

    const [customers] = await queryInterface.sequelize.query(
      `SELECT u.id
       FROM users u
       INNER JOIN roles r ON r.id = u."roleId"
       WHERE r.name = 'CUSTOMER' AND u."deletedAt" IS NULL
       LIMIT 50`,
    );
    const [vendors] = await queryInterface.sequelize.query(
      `SELECT id FROM vendors WHERE "deletedAt" IS NULL LIMIT 20`,
    );
    const [vendorStaff] = await queryInterface.sequelize.query(
      `SELECT u.id AS "userId", u."vendorId"
       FROM users u
       INNER JOIN roles r ON r.id = u."roleId"
       WHERE r.name IN ('VENDOR_OWNER', 'VENDOR_STAFF')
         AND u."vendorId" IS NOT NULL
         AND u."deletedAt" IS NULL
       LIMIT 50`,
    );
    const [admins] = await queryInterface.sequelize.query(
      `SELECT u.id
       FROM users u
       INNER JOIN roles r ON r.id = u."roleId"
       WHERE r.name IN ('SUPER_ADMIN', 'ADMIN_ORDER_MANAGER')
         AND u."deletedAt" IS NULL
       LIMIT 10`,
    );

    if (customers.length === 0) {
      console.log('seed-support-tickets: no customers found — skipping');
      return;
    }

    const staffByVendor = new Map();
    for (const row of vendorStaff) {
      if (!staffByVendor.has(row.vendorId)) staffByVendor.set(row.vendorId, row.userId);
    }
    const adminId = admins.length > 0 ? admins[0].id : null;

    const now = new Date();
    const tickets = [];
    const messages = [];
    const ticketCount = 520;
    let heavyTicketId = null;

    for (let i = 0; i < ticketCount; i += 1) {
      const id = uuidv4();
      const customer = pick(customers, i);
      const vendor = vendors.length > 0 ? pick(vendors, i) : null;
      const status = pick(STATUSES, i);
      const createdAt = new Date(now.getTime() - i * 60_000);
      const assignedToId = vendor
        ? staffByVendor.get(vendor.id) ?? null
        : adminId;
      const ticket = {
        id,
        ticketNumber: `TKT-${String(100000 + i).padStart(6, '0')}`,
        customerId: customer.id,
        subject: `Seed support ticket ${i + 1}`,
        description: `Seeded description for support ticket ${i + 1}.`,
        category: pick(CATEGORIES, i),
        relatedOrderId: null,
        relatedVendorId: vendor ? vendor.id : null,
        priority: pick(PRIORITIES, i),
        status,
        assignedToId,
        firstResponseAt: status === 'OPEN' ? null : createdAt,
        resolvedAt: status === 'RESOLVED' || status === 'CLOSED' ? createdAt : null,
        closedAt: status === 'CLOSED' ? createdAt : null,
        customerSatisfactionRating: null,
        createdBy: customer.id,
        updatedBy: null,
        deletedBy: null,
        createdAt,
        updatedAt: createdAt,
        deletedAt: null,
      };
      tickets.push(ticket);

      messages.push({
        id: uuidv4(),
        ticketId: id,
        senderId: customer.id,
        senderRole: 'CUSTOMER',
        body: ticket.description,
        createdBy: customer.id,
        updatedBy: null,
        deletedBy: null,
        createdAt,
        updatedAt: createdAt,
        deletedAt: null,
      });

      if (i === 0) heavyTicketId = id;
    }

    // One ticket with 80+ messages for thread pagination testing.
    if (heavyTicketId) {
      const customerId = tickets[0].customerId;
      const staffSenderId =
        tickets[0].assignedToId || adminId || customerId;
      const staffRole = tickets[0].assignedToId
        ? 'VENDOR'
        : adminId
          ? 'SUPER_ADMIN'
          : 'CUSTOMER';
      for (let m = 0; m < 85; m += 1) {
        const createdAt = new Date(now.getTime() - m * 30_000);
        const fromCustomer = m % 3 !== 0;
        messages.push({
          id: uuidv4(),
          ticketId: heavyTicketId,
          senderId: fromCustomer ? customerId : staffSenderId,
          senderRole: fromCustomer ? 'CUSTOMER' : staffRole,
          body: `Seeded thread message ${m + 1} on heavy ticket.`,
          createdBy: fromCustomer ? customerId : staffSenderId,
          updatedBy: null,
          deletedBy: null,
          createdAt,
          updatedAt: createdAt,
          deletedAt: null,
        });
      }
    }

    const chunkSize = 100;
    for (let i = 0; i < tickets.length; i += chunkSize) {
      await queryInterface.bulkInsert('support_tickets', tickets.slice(i, i + chunkSize));
    }
    for (let i = 0; i < messages.length; i += chunkSize) {
      await queryInterface.bulkInsert('ticket_messages', messages.slice(i, i + chunkSize));
    }

    // Advance document sequence past seeded numbers.
    await queryInterface.sequelize.query(
      `UPDATE document_sequences
       SET "nextValue" = GREATEST("nextValue", :nextValue), "updatedAt" = :now
       WHERE kind = 'SUPPORT_TICKET'`,
      { replacements: { nextValue: 100000 + ticketCount, now } },
    );

    console.log(
      `seed-support-tickets: inserted ${tickets.length} tickets and ${messages.length} messages`,
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      `DELETE FROM ticket_messages WHERE body LIKE 'Seeded%' OR body LIKE 'Seeded description%'`,
    );
    await queryInterface.sequelize.query(
      `DELETE FROM support_tickets WHERE subject LIKE 'Seed support ticket %'`,
    );
  },
};

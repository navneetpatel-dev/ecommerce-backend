'use strict';

/**
 * Seeds support tickets + bug reports for a specific customer email
 * so that account can be used to verify list/detail/thread UX.
 */
const { v4: uuidv4 } = require('uuid');

const TARGET_EMAIL = 'amit.gupta54@example.com';
const TICKET_SUBJECT_PREFIX = 'Amit seed ticket';
const BUG_TITLE_PREFIX = 'Amit seed bug';

const TICKET_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'REOPENED'];
const TICKET_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
const TICKET_CATEGORIES = ['ORDER', 'PRODUCT', 'PAYMENT', 'VENDOR', 'OTHER'];

const BUG_STATUSES = [
  'NEW',
  'TRIAGED',
  'IN_PROGRESS',
  'FIXED',
  'VERIFIED',
  'CLOSED',
  'WONT_FIX',
];
const BUG_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const BUG_MODULES = [
  'CATALOG',
  'CART',
  'CHECKOUT',
  'PAYMENTS',
  'ORDERS',
  'OTHER',
];

function pick(arr, index) {
  return arr[index % arr.length];
}

module.exports = {
  async up(queryInterface) {
    const [users] = await queryInterface.sequelize.query(
      `SELECT u.id, u.email, r.name AS role
       FROM users u
       INNER JOIN roles r ON r.id = u."roleId"
       WHERE lower(u.email) = lower(:email) AND u."deletedAt" IS NULL
       LIMIT 1`,
      { replacements: { email: TARGET_EMAIL } },
    );

    if (users.length === 0) {
      console.log(`seed-amit-support: user ${TARGET_EMAIL} not found — skipping`);
      return;
    }

    const user = users[0];
    if (user.role !== 'CUSTOMER') {
      console.log(
        `seed-amit-support: ${TARGET_EMAIL} is ${user.role}, expected CUSTOMER — skipping tickets create rules may differ`,
      );
    }

    const [existingTickets] = await queryInterface.sequelize.query(
      `SELECT id FROM support_tickets
       WHERE "customerId" = :userId AND subject LIKE :prefix AND "deletedAt" IS NULL
       LIMIT 1`,
      { replacements: { userId: user.id, prefix: `${TICKET_SUBJECT_PREFIX} %` } },
    );
    const [existingBugs] = await queryInterface.sequelize.query(
      `SELECT id FROM bug_reports
       WHERE "reporterId" = :userId AND title LIKE :prefix AND "deletedAt" IS NULL
       LIMIT 1`,
      { replacements: { userId: user.id, prefix: `${BUG_TITLE_PREFIX} %` } },
    );

    if (existingTickets.length > 0 && existingBugs.length > 0) {
      console.log(`seed-amit-support: already seeded for ${TARGET_EMAIL} — skipping`);
      return;
    }

    const [vendors] = await queryInterface.sequelize.query(
      `SELECT id FROM vendors WHERE "deletedAt" IS NULL LIMIT 10`,
    );
    const [admins] = await queryInterface.sequelize.query(
      `SELECT u.id
       FROM users u
       INNER JOIN roles r ON r.id = u."roleId"
       WHERE r.name IN ('SUPER_ADMIN', 'ADMIN_ORDER_MANAGER') AND u."deletedAt" IS NULL
       LIMIT 5`,
    );

    const now = new Date();
    const ticketCount = 12;
    const bugCount = 10;
    const tickets = [];
    const messages = [];
    const bugs = [];
    const comments = [];

    if (existingTickets.length === 0) {
      let heavyTicketId = null;
      for (let i = 0; i < ticketCount; i += 1) {
        const id = uuidv4();
        const status = pick(TICKET_STATUSES, i);
        const createdAt = new Date(now.getTime() - i * 90_000);
        const vendor = vendors.length > 0 ? pick(vendors, i) : null;
        tickets.push({
          id,
          ticketNumber: `TKT-${String(200000 + i).padStart(6, '0')}`,
          customerId: user.id,
          subject: `${TICKET_SUBJECT_PREFIX} ${i + 1}`,
          description: `Personal seed ticket ${i + 1} for ${TARGET_EMAIL}.`,
          category: pick(TICKET_CATEGORIES, i),
          relatedOrderId: null,
          relatedVendorId: vendor ? vendor.id : null,
          priority: pick(TICKET_PRIORITIES, i),
          status,
          assignedToId: admins.length > 0 && status !== 'OPEN' ? pick(admins, i).id : null,
          firstResponseAt: status === 'OPEN' ? null : createdAt,
          resolvedAt:
            status === 'RESOLVED' || status === 'CLOSED' ? createdAt : null,
          closedAt: status === 'CLOSED' ? createdAt : null,
          customerSatisfactionRating: null,
          createdBy: user.id,
          updatedBy: null,
          deletedBy: null,
          createdAt,
          updatedAt: createdAt,
          deletedAt: null,
        });

        messages.push({
          id: uuidv4(),
          ticketId: id,
          senderId: user.id,
          senderRole: 'CUSTOMER',
          body: `Personal seed ticket ${i + 1} for ${TARGET_EMAIL}.`,
          createdBy: user.id,
          updatedBy: null,
          deletedBy: null,
          createdAt,
          updatedAt: createdAt,
          deletedAt: null,
        });

        if (i === 0) heavyTicketId = id;
      }

      if (heavyTicketId) {
        for (let m = 0; m < 25; m += 1) {
          const createdAt = new Date(now.getTime() - m * 20_000);
          const isStaff = m % 2 === 1 && admins.length > 0;
          messages.push({
            id: uuidv4(),
            ticketId: heavyTicketId,
            senderId: isStaff ? admins[0].id : user.id,
            senderRole: isStaff ? 'SUPER_ADMIN' : 'CUSTOMER',
            body: `Amit seed thread message ${m + 1}.`,
            createdBy: isStaff ? admins[0].id : user.id,
            updatedBy: null,
            deletedBy: null,
            createdAt,
            updatedAt: createdAt,
            deletedAt: null,
          });
        }
      }

      const chunkSize = 50;
      for (let i = 0; i < tickets.length; i += chunkSize) {
        await queryInterface.bulkInsert('support_tickets', tickets.slice(i, i + chunkSize));
      }
      for (let i = 0; i < messages.length; i += chunkSize) {
        await queryInterface.bulkInsert('ticket_messages', messages.slice(i, i + chunkSize));
      }

      await queryInterface.sequelize.query(
        `UPDATE document_sequences
         SET "nextValue" = GREATEST("nextValue", :nextValue), "updatedAt" = :now
         WHERE kind = 'SUPPORT_TICKET'`,
        { replacements: { nextValue: 200000 + ticketCount, now } },
      );
    }

    if (existingBugs.length === 0) {
      let firstBugId = null;
      for (let i = 0; i < bugCount; i += 1) {
        const id = uuidv4();
        if (i === 0) firstBugId = id;
        const status = pick(BUG_STATUSES, i);
        const createdAt = new Date(now.getTime() - i * 120_000);
        bugs.push({
          id,
          reportNumber: `BUG-${String(200000 + i).padStart(6, '0')}`,
          reporterId: user.id,
          reporterRole: 'CUSTOMER',
          title: `${BUG_TITLE_PREFIX} ${i + 1}`,
          description: `Personal seed bug ${i + 1} filed by ${TARGET_EMAIL}.`,
          stepsToReproduce: `1. Sign in as ${TARGET_EMAIL}\n2. Reproduce issue ${i + 1}\n3. Observe failure`,
          severity: pick(BUG_SEVERITIES, i),
          status,
          duplicateOfId: null,
          assignedToId: admins.length > 0 && status !== 'NEW' ? pick(admins, i).id : null,
          affectedModule: pick(BUG_MODULES, i),
          pageUrl: 'https://localhost:5173/support/bug-reports/new',
          userAgent: 'Mozilla/5.0 (Macintosh; Seed) Chrome/120.0.0.0',
          browserName: 'Chrome',
          osName: 'macOS',
          deviceType: 'desktop',
          appVersion: '1.0.0',
          userId: user.id,
          userRole: 'CUSTOMER',
          occurredAt: createdAt,
          triagedAt: status === 'NEW' ? null : new Date(createdAt.getTime() + 5 * 60_000),
          inProgressAt:
            status === 'IN_PROGRESS' ||
            status === 'FIXED' ||
            status === 'VERIFIED' ||
            status === 'CLOSED'
              ? new Date(createdAt.getTime() + 10 * 60_000)
              : null,
          resolvedAt:
            status === 'FIXED' || status === 'VERIFIED' || status === 'CLOSED' || status === 'WONT_FIX'
              ? new Date(createdAt.getTime() + 30 * 60_000)
              : null,
          verifiedAt:
            status === 'VERIFIED' || status === 'CLOSED'
              ? new Date(createdAt.getTime() + 45 * 60_000)
              : null,
          wontFixReason: status === 'WONT_FIX' ? 'Amit seed wont-fix reason' : null,
          createdBy: user.id,
          updatedBy: null,
          deletedBy: null,
          createdAt,
          updatedAt: createdAt,
          deletedAt: null,
        });
      }

      if (firstBugId && admins.length > 0) {
        for (let c = 0; c < 8; c += 1) {
          const createdAt = new Date(now.getTime() - c * 40_000);
          comments.push({
            id: uuidv4(),
            bugReportId: firstBugId,
            authorId: admins[0].id,
            body: `Amit seed internal note ${c + 1}.`,
            createdBy: admins[0].id,
            updatedBy: null,
            deletedBy: null,
            createdAt,
            updatedAt: createdAt,
            deletedAt: null,
          });
        }
      }

      const chunkSize = 50;
      for (let i = 0; i < bugs.length; i += chunkSize) {
        await queryInterface.bulkInsert('bug_reports', bugs.slice(i, i + chunkSize));
      }
      for (let i = 0; i < comments.length; i += chunkSize) {
        await queryInterface.bulkInsert('bug_report_comments', comments.slice(i, i + chunkSize));
      }

      await queryInterface.sequelize.query(
        `UPDATE document_sequences
         SET "nextValue" = GREATEST("nextValue", :nextValue), "updatedAt" = :now
         WHERE kind = 'BUG_REPORT'`,
        { replacements: { nextValue: 200000 + bugCount, now } },
      );
    }

    console.log(
      `seed-amit-support: ${TARGET_EMAIL} → ` +
        `${existingTickets.length ? 0 : tickets.length} tickets, ` +
        `${existingTickets.length ? 0 : messages.length} messages, ` +
        `${existingBugs.length ? 0 : bugs.length} bugs, ` +
        `${existingBugs.length ? 0 : comments.length} comments`,
    );
  },

  async down(queryInterface) {
    const [users] = await queryInterface.sequelize.query(
      `SELECT id FROM users WHERE lower(email) = lower(:email) LIMIT 1`,
      { replacements: { email: TARGET_EMAIL } },
    );
    if (users.length === 0) return;
    const userId = users[0].id;

    await queryInterface.sequelize.query(
      `DELETE FROM bug_report_comments
       WHERE "bugReportId" IN (
         SELECT id FROM bug_reports
         WHERE "reporterId" = :userId AND title LIKE :prefix
       )`,
      { replacements: { userId, prefix: `${BUG_TITLE_PREFIX} %` } },
    );
    await queryInterface.sequelize.query(
      `DELETE FROM bug_reports WHERE "reporterId" = :userId AND title LIKE :prefix`,
      { replacements: { userId, prefix: `${BUG_TITLE_PREFIX} %` } },
    );
    await queryInterface.sequelize.query(
      `DELETE FROM ticket_messages
       WHERE "ticketId" IN (
         SELECT id FROM support_tickets
         WHERE "customerId" = :userId AND subject LIKE :prefix
       )`,
      { replacements: { userId, prefix: `${TICKET_SUBJECT_PREFIX} %` } },
    );
    await queryInterface.sequelize.query(
      `DELETE FROM support_tickets WHERE "customerId" = :userId AND subject LIKE :prefix`,
      { replacements: { userId, prefix: `${TICKET_SUBJECT_PREFIX} %` } },
    );
  },
};

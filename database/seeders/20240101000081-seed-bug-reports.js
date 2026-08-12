'use strict';

const { v4: uuidv4 } = require('uuid');

const STATUSES = [
  'NEW',
  'TRIAGED',
  'IN_PROGRESS',
  'FIXED',
  'VERIFIED',
  'CLOSED',
  'WONT_FIX',
  'DUPLICATE',
];
const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const MODULES = [
  'CATALOG',
  'CART',
  'CHECKOUT',
  'PAYMENTS',
  'ORDERS',
  'VENDOR_DASHBOARD',
  'ADMIN_DASHBOARD',
  'OTHER',
];
const BROWSERS = ['Chrome', 'Safari', 'Firefox', 'Edge'];
const OSES = ['macOS', 'Windows', 'iOS', 'Android'];
const DEVICES = ['desktop', 'mobile', 'tablet'];

function pick(arr, index) {
  return arr[index % arr.length];
}

module.exports = {
  async up(queryInterface) {
    const [already] = await queryInterface.sequelize.query(
      `SELECT id FROM bug_reports
       WHERE title LIKE 'Seed bug report %' AND "deletedAt" IS NULL
       LIMIT 1`,
    );
    if (already.length > 0) {
      console.log('seed-bug-reports: already seeded — skipping');
      return;
    }

    const [customers] = await queryInterface.sequelize.query(
      `SELECT u.id, r.name AS role
       FROM users u
       INNER JOIN roles r ON r.id = u."roleId"
       WHERE r.name = 'CUSTOMER' AND u."deletedAt" IS NULL
       LIMIT 40`,
    );
    const [vendors] = await queryInterface.sequelize.query(
      `SELECT u.id, r.name AS role
       FROM users u
       INNER JOIN roles r ON r.id = u."roleId"
       WHERE r.name IN ('VENDOR_OWNER', 'VENDOR_STAFF') AND u."deletedAt" IS NULL
       LIMIT 20`,
    );
    const [admins] = await queryInterface.sequelize.query(
      `SELECT u.id
       FROM users u
       INNER JOIN roles r ON r.id = u."roleId"
       WHERE r.name IN ('SUPER_ADMIN', 'ADMIN_ORDER_MANAGER') AND u."deletedAt" IS NULL
       LIMIT 5`,
    );

    const reporters = [
      ...customers.map((u) => ({ id: u.id, role: 'CUSTOMER', userRole: 'CUSTOMER' })),
      ...vendors.map((u) => ({
        id: u.id,
        role: u.role === 'VENDOR_STAFF' ? 'VENDOR_STAFF' : 'VENDOR',
        userRole: u.role,
      })),
    ];

    if (reporters.length === 0) {
      console.log('seed-bug-reports: no reporters found — skipping');
      return;
    }

    const now = new Date();
    const reportCount = 520;
    const reports = [];
    const comments = [];
    let firstId = null;
    let secondId = null;

    for (let i = 0; i < reportCount; i += 1) {
      const id = uuidv4();
      if (i === 0) firstId = id;
      if (i === 1) secondId = id;

      const reporter = pick(reporters, i);
      const status = pick(STATUSES, i);
      const createdAt = new Date(now.getTime() - i * 60_000);
      const triaged =
        status !== 'NEW'
          ? new Date(createdAt.getTime() + 5 * 60_000)
          : null;
      const resolved =
        status === 'FIXED' ||
        status === 'VERIFIED' ||
        status === 'CLOSED' ||
        status === 'WONT_FIX'
          ? new Date(createdAt.getTime() + 30 * 60_000)
          : null;
      const inProgressAt =
        status === 'IN_PROGRESS' ||
        status === 'FIXED' ||
        status === 'VERIFIED' ||
        status === 'CLOSED'
          ? new Date(createdAt.getTime() + 10 * 60_000)
          : null;
      const verifiedAt =
        status === 'VERIFIED' || status === 'CLOSED'
          ? new Date(createdAt.getTime() + 45 * 60_000)
          : null;

      reports.push({
        id,
        reportNumber: `BUG-${String(100000 + i).padStart(6, '0')}`,
        reporterId: reporter.id,
        reporterRole: reporter.role,
        title: `Seed bug report ${i + 1}`,
        description: `Seeded description for bug report ${i + 1}.`,
        stepsToReproduce: `1. Open module\n2. Reproduce issue ${i + 1}\n3. Observe failure`,
        severity: pick(SEVERITIES, i),
        status,
        duplicateOfId: null,
        assignedToId: admins.length > 0 && status !== 'NEW' ? pick(admins, i).id : null,
        affectedModule: pick(MODULES, i),
        pageUrl: `https://example.local/seed/page-${(i % 20) + 1}`,
        userAgent: 'Mozilla/5.0 (Seed) AppleWebKit/537.36 Chrome/120.0.0.0',
        browserName: pick(BROWSERS, i),
        osName: pick(OSES, i),
        deviceType: pick(DEVICES, i),
        appVersion: '1.0.0',
        userId: reporter.id,
        userRole: reporter.userRole,
        occurredAt: createdAt,
        triagedAt: triaged,
        inProgressAt,
        resolvedAt: resolved,
        verifiedAt,
        wontFixReason: status === 'WONT_FIX' ? 'Seeded wont-fix reason' : null,
        createdBy: reporter.id,
        updatedBy: null,
        deletedBy: null,
        createdAt,
        updatedAt: createdAt,
        deletedAt: null,
      });
    }

    // One FIXED bug resolved outside the (default 7-day) bugVerifyWindowDays, so the
    // auto-verify sweep (`markVerifiedIfDue`) has a candidate to act on out of the box.
    if (reports.length > 2) {
      const autoVerifyCandidate = reports[2];
      autoVerifyCandidate.status = 'FIXED';
      autoVerifyCandidate.duplicateOfId = null;
      autoVerifyCandidate.triagedAt = new Date(autoVerifyCandidate.createdAt.getTime() + 5 * 60_000);
      autoVerifyCandidate.inProgressAt = new Date(autoVerifyCandidate.createdAt.getTime() + 10 * 60_000);
      autoVerifyCandidate.resolvedAt = new Date(now.getTime() - 9 * 24 * 60 * 60 * 1000);
      autoVerifyCandidate.verifiedAt = null;
      autoVerifyCandidate.wontFixReason = null;
    }

    // Link a few DUPLICATE rows to the first report after bulk insert update.
    const duplicateIndexes = [];
    for (let i = 0; i < reports.length; i += 1) {
      if (reports[i].status === 'DUPLICATE' && firstId && reports[i].id !== firstId) {
        reports[i].duplicateOfId = firstId;
        duplicateIndexes.push(i);
      }
    }

    // Internal admin comments on the first report for pagination/UI testing.
    if (firstId && admins.length > 0) {
      const adminId = admins[0].id;
      for (let c = 0; c < 40; c += 1) {
        const createdAt = new Date(now.getTime() - c * 45_000);
        comments.push({
          id: uuidv4(),
          bugReportId: firstId,
          authorId: adminId,
          body: `Seeded internal triage note ${c + 1}.`,
          createdBy: adminId,
          updatedBy: null,
          deletedBy: null,
          createdAt,
          updatedAt: createdAt,
          deletedAt: null,
        });
      }
    }

    // Ensure at least one non-duplicate canonical report stays NEW/TRIAGED without self-link.
    if (secondId) {
      const second = reports.find((r) => r.id === secondId);
      if (second && second.status === 'DUPLICATE') {
        second.status = 'TRIAGED';
        second.duplicateOfId = null;
        second.triagedAt = new Date(second.createdAt.getTime() + 5 * 60_000);
      }
    }

    const chunkSize = 100;
    for (let i = 0; i < reports.length; i += chunkSize) {
      await queryInterface.bulkInsert('bug_reports', reports.slice(i, i + chunkSize));
    }
    for (let i = 0; i < comments.length; i += chunkSize) {
      await queryInterface.bulkInsert('bug_report_comments', comments.slice(i, i + chunkSize));
    }

    // Placeholder screenshots on the first 3 reports (idempotent with the early skip above).
    const attachments = [];
    for (let i = 0; i < Math.min(3, reports.length); i += 1) {
      const createdAt = reports[i].createdAt;
      attachments.push({
        id: uuidv4(),
        bugReportId: reports[i].id,
        url: `https://example.com/seed/bug-report-${i + 1}-screenshot.png`,
        type: 'SCREENSHOT',
        durationSeconds: null,
        createdBy: reports[i].reporterId,
        updatedBy: null,
        deletedBy: null,
        createdAt,
        updatedAt: createdAt,
        deletedAt: null,
      });
    }
    if (attachments.length > 0) {
      await queryInterface.bulkInsert('bug_report_attachments', attachments);
    }

    await queryInterface.sequelize.query(
      `UPDATE document_sequences
       SET "nextValue" = GREATEST("nextValue", :nextValue), "updatedAt" = :now
       WHERE kind = 'BUG_REPORT'`,
      { replacements: { nextValue: 100000 + reportCount, now } },
    );

    console.log(
      `seed-bug-reports: inserted ${reports.length} reports` +
        `${comments.length ? ` and ${comments.length} comments` : ''}` +
        `${attachments.length ? ` and ${attachments.length} attachments` : ''}` +
        `${duplicateIndexes.length ? ` (${duplicateIndexes.length} duplicates linked)` : ''}`,
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      `DELETE FROM bug_report_attachments
       WHERE url LIKE 'https://example.com/seed/bug-report-%-screenshot.png'`,
    );
    await queryInterface.sequelize.query(
      `DELETE FROM bug_report_comments WHERE body LIKE 'Seeded internal triage note %'`,
    );
    await queryInterface.sequelize.query(
      `DELETE FROM bug_reports WHERE title LIKE 'Seed bug report %'`,
    );
  },
};

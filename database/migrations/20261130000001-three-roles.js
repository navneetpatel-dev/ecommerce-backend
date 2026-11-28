'use strict';

const { randomUUID } = require('node:crypto');

/**
 * The platform has three roles: SUPER_ADMIN, VENDOR_OWNER ("Vendor") and CUSTOMER.
 *
 *  - Accounts holding any other role (vendor staff, the admin managers, custom roles) become
 *    customers: unlinked from their store, signed out, and without the exports and in-app notices
 *    they received in their old role. Nobody is promoted. Tickets assigned to them go back to the
 *    store's vendor (or to nobody); bug reports become unassigned.
 *  - The other roles and the permissions that only existed to separate them are deleted, and the
 *    three roles get exactly their permissions.
 *  - Ticket sender and bug reporter roles recorded in the old terms are restated, and the database
 *    refuses those values from now on.
 *
 * `down` restores the roles, permissions and allowed values; it cannot know who held what.
 * Safe to run again.
 */
const KEPT = ['SUPER_ADMIN', 'VENDOR_OWNER', 'CUSTOMER'];
const REMOVED_PERMISSIONS = ['role.manage', 'team.manage', 'coupon.unlimited', 'analytics.revenue'];
const VENDOR_PERMISSIONS = [
  'product.create',
  'product.update',
  'product.delete',
  'suborder.manage',
  'payout.view',
  'review.respond',
];

/** What `down` puts back (the allocation before this migration). */
const FORMER_ROLES = {
  ADMIN_ORDER_MANAGER: ['order.manage', 'suborder.manage', 'order.refund', 'shipping.manage', 'analytics.view', 'ticket.manage'],
  ADMIN_CATALOG_MANAGER: [
    'product.manage', 'product.create', 'product.approve', 'category.manage', 'coupon.manage', 'banner.manage',
    'review.moderate', 'analytics.view',
  ],
  ADMIN_FINANCE_MANAGER: [
    'payout.manage', 'commission.view', 'analytics.view', 'analytics.revenue', 'wallet.adjust', 'cashback.manage',
    'gift_card.manage',
  ],
  VENDOR_STAFF: ['product.update', 'suborder.manage'],
};

const SENDERS = ['CUSTOMER', 'VENDOR', 'ADMIN', 'SUPER_ADMIN'];
const FORMER_SENDERS = [...SENDERS, 'VENDOR_STAFF', 'ADMIN_ORDER_MANAGER', 'ADMIN_CATALOG_MANAGER'];
const REPORTERS = ['CUSTOMER', 'VENDOR'];

const GRANT_SQL = `INSERT INTO "RolePermissions" ("roleId", "permissionId", "createdAt", "updatedAt")
  SELECT r.id, p.id, now(), now()
  FROM roles r, permissions p
  WHERE r.name = :role AND p.key IN (:keys)
    AND NOT EXISTS (
      SELECT 1 FROM "RolePermissions" rp WHERE rp."roleId" = r.id AND rp."permissionId" = p.id
    )`;

const quoted = (values) => values.map((value) => `'${value}'`).join(', ');

async function senderCheck(q, allowed) {
  await q('ALTER TABLE ticket_messages DROP CONSTRAINT IF EXISTS ticket_messages_sender_role_chk');
  await q(
    `ALTER TABLE ticket_messages ADD CONSTRAINT ticket_messages_sender_role_chk
       CHECK ("senderRole" IN (${quoted(allowed)}))`,
  );
}

async function reporterEnum(q, values) {
  const type = '"enum_bug_reports_reporterRole"';
  const old = '"enum_bug_reports_reporterRole_old"';
  await q(`ALTER TYPE ${type} RENAME TO ${old}`);
  await q(`CREATE TYPE ${type} AS ENUM (${quoted(values)})`);
  await q(`ALTER TABLE bug_reports ALTER COLUMN "reporterRole" TYPE ${type} USING "reporterRole"::text::${type}`);
  await q(`DROP TYPE ${old}`);
}

async function ensureRole(q, name) {
  await q(
    `INSERT INTO roles (id, name, "createdAt", "updatedAt")
     SELECT :id, :name, now(), now() WHERE NOT EXISTS (SELECT 1 FROM roles WHERE name = :name)`,
    { id: randomUUID(), name },
  );
}

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const q = (sql, replacements) => queryInterface.sequelize.query(sql, { transaction, replacements });
      for (const name of KEPT) await ensureRole(q, name);

      // The accounts that lose their role, remembered before anything changes.
      await q(
        `CREATE TEMPORARY TABLE converted_users AS
           SELECT u.id, u."vendorId" FROM users u JOIN roles r ON r.id = u."roleId" WHERE r.name NOT IN (:kept)`,
        { kept: KEPT },
      );
      await q(
        `UPDATE support_tickets t SET "assignedToId" = (
             SELECT o.id FROM users o JOIN roles r ON r.id = o."roleId" AND r.name = 'VENDOR_OWNER'
              WHERE o."vendorId" = t."relatedVendorId" AND o."deletedAt" IS NULL
              ORDER BY o."createdAt" LIMIT 1)
          WHERE t."assignedToId" IN (SELECT id FROM converted_users)`,
      );
      await q('UPDATE bug_reports SET "assignedToId" = NULL WHERE "assignedToId" IN (SELECT id FROM converted_users)');
      for (const [table, column] of [
        ['refresh_tokens', 'userId'],
        ['in_app_notifications', 'userId'],
        ['export_jobs', 'ownerId'],
      ]) {
        await q(`DELETE FROM ${table} WHERE "${column}" IN (SELECT id FROM converted_users)`);
      }
      await q(
        `UPDATE users SET "roleId" = (SELECT id FROM roles WHERE name = 'CUSTOMER'), "vendorId" = NULL, "updatedAt" = now()
          WHERE id IN (SELECT id FROM converted_users)`,
      );

      await q('DROP TABLE converted_users');

      // RolePermissions rows go with their role or permission (ON DELETE CASCADE).
      await q('DELETE FROM roles WHERE name NOT IN (:kept)', { kept: KEPT });
      await q('DELETE FROM permissions WHERE key IN (:keys)', { keys: REMOVED_PERMISSIONS });
      await q(
        `DELETE FROM "RolePermissions" WHERE "roleId" IN (SELECT id FROM roles WHERE name IN ('VENDOR_OWNER', 'CUSTOMER'))
           AND "permissionId" NOT IN (
             SELECT p.id FROM permissions p, roles r
              WHERE r.id = "RolePermissions"."roleId" AND r.name = 'VENDOR_OWNER' AND p.key IN (:keys))`,
        { keys: VENDOR_PERMISSIONS },
      );
      await q(GRANT_SQL, { role: 'VENDOR_OWNER', keys: VENDOR_PERMISSIONS });
      await q(
        `INSERT INTO "RolePermissions" ("roleId", "permissionId", "createdAt", "updatedAt")
         SELECT r.id, p.id, now(), now() FROM roles r, permissions p
          WHERE r.name = 'SUPER_ADMIN'
            AND NOT EXISTS (SELECT 1 FROM "RolePermissions" rp WHERE rp."roleId" = r.id AND rp."permissionId" = p.id)`,
      );

      await q('ALTER TABLE ticket_messages DROP CONSTRAINT IF EXISTS ticket_messages_sender_role_chk');
      await q(`UPDATE ticket_messages SET "senderRole" = 'VENDOR' WHERE "senderRole" = 'VENDOR_STAFF'`);
      await q(`UPDATE ticket_messages SET "senderRole" = 'ADMIN' WHERE "senderRole" NOT IN (:senders)`, { senders: SENDERS });
      await senderCheck(q, SENDERS);

      await q(`UPDATE bug_reports SET "reporterRole" = 'VENDOR' WHERE "reporterRole"::text = 'VENDOR_STAFF'`);
      await reporterEnum(q, REPORTERS);

      await q(`DELETE FROM notification_logs WHERE type IN ('VENDOR_STAFF_INVITE', 'VENDOR_STAFF_ROLE_CHANGED')`);
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const q = (sql, replacements) => queryInterface.sequelize.query(sql, { transaction, replacements });

      for (const key of REMOVED_PERMISSIONS) {
        await q(
          `INSERT INTO permissions (id, key, "createdAt", "updatedAt")
           SELECT :id, :key, now(), now() WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE key = :key)`,
          { id: randomUUID(), key },
        );
      }
      for (const [role, keys] of Object.entries(FORMER_ROLES)) {
        await ensureRole(q, role);
        await q(GRANT_SQL, { role, keys });
      }
      await q(GRANT_SQL, { role: 'SUPER_ADMIN', keys: REMOVED_PERMISSIONS });
      await q(GRANT_SQL, { role: 'VENDOR_OWNER', keys: ['team.manage'] });

      await senderCheck(q, FORMER_SENDERS);
      await reporterEnum(q, [...REPORTERS, 'VENDOR_STAFF']);
    });
  },
};

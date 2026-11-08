'use strict';

/**
 * Removes the in-house delivery-agent workflow from databases created before it was dropped.
 * Parcels now move through the carrier webhook or an admin (`PATCH /shipping/admin/shipments/:id/status`),
 * and return pickups are confirmed by an admin on the return itself.
 *
 * Every step is guarded (IF EXISTS / WHERE), so on a fresh database, which never had any of
 * this, the migration changes nothing. It runs in one transaction.
 *
 * Agent user accounts are deleted. An account that a business record still has to point at
 * (it placed an order, wrote a review, opened a ticket, ...) is kept as a CUSTOMER instead,
 * so no order history is lost.
 */

const AGENT_TABLES = [
  'delivery_ratings',
  'delivery_agent_earnings',
  'delivery_agent_payouts',
  'delivery_agent_documents',
  'delivery_cash_deposits',
  'delivery_agents',
];

const DROPPED_COLUMNS = {
  users: ['deliveryAgentId'],
  shipments: ['deliveryAgentId', 'assignedAt', 'proofOfDeliveryUrl', 'deliveryOtpVerifiedAt', 'rtoHandoverOtpVerifiedAt'],
  return_requests: [
    'deliveryAgentId',
    'pickupOtpVerifiedAt',
    'pickupFailureReason',
    'preferredRepickupSlot',
    'replacementProofUrl',
  ],
  otp_codes: ['subjectId'],
};

const DROPPED_INDEXES = [
  'shipments_delivery_agent_id',
  'return_requests_delivery_agent_id',
  'otp_codes_user_purpose_subject',
];

const AGENT_PERMISSIONS = ['delivery_agent.manage', 'shipment.delivery_update', 'return.pickup_update'];

const AGENT_NOTIFICATION_TYPES = [
  'DELIVERY_ASSIGNED',
  'PICKUP_ASSIGNED',
  'DELIVERY_OTP',
  'RETURN_PICKUP_OTP',
  'RTO_HANDOVER_OTP',
  'PICKUP_ATTEMPT_FAILED',
  'DELIVERY_AGENT_DOCUMENT_EXPIRING',
  'DELIVERY_AGENT_DOCUMENT_EXPIRED',
  'CASH_DEPOSIT_VERIFIED',
  'CASH_DEPOSIT_REJECTED',
  'RTO_HANDOVER_CONFIRMED',
];

const AGENT_ENTITY_TYPES = [
  'DeliveryAgent',
  'DeliveryAgentDocument',
  'DeliveryAgentEarning',
  'DeliveryAgentPayout',
  'DeliveryCashDeposit',
  'DeliveryRating',
];

const AGENT_SETTING_KEYS = [
  'deliveryAgentPerTaskEarning',
  'deliveryAgentTdsRatePercent',
  'deliveryAgentTdsNoPanRatePercent',
  'deliveryAgentTdsSingleThreshold',
  'deliveryAgentTdsAnnualThreshold',
];

/** Migrations that only built the agent workflow, plus the old names of the three that were renamed. */
const RETIRED_MIGRATIONS = [
  '20260903000004-create-delivery-agents.js',
  '20260903000005-add-delivery-workflow-columns.js',
  '20260904000001-delivery-module-gap-fixes.js',
  '20260904000002-delivery-part4-fullfledged.js',
  '20260904000003-delivery-agent-payouts.js',
  '20260904000005-delivery-agent-documents.js',
  '20260904000007-return-pickup-reschedule.js',
  '20260904000008-delivery-ratings.js',
  '20260904000009-delivery-agent-document-expiry.js',
  '20260927000003-delivery-agent-payout-tds.js',
  '20261018000006-otp-code-subject.js',
];

const quoteList = (values) => values.map((v) => `'${v.replace(/'/g, "''")}'`).join(', ');

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const run = (sql) => queryInterface.sequelize.query(sql, { transaction });
      const rows = async (sql) => (await run(sql))[0];

      // 1. Who the agents are: the DELIVERY_AGENT role, or a user linked to an agent profile.
      const hasUserAgentColumn = (
        await rows(`SELECT 1 FROM information_schema.columns
                    WHERE table_schema = current_schema() AND table_name = 'users' AND column_name = 'deliveryAgentId'`)
      ).length > 0;
      const agentRows = await rows(`
        SELECT u.id FROM users u
        LEFT JOIN roles r ON r.id = u."roleId"
        WHERE r.name = 'DELIVERY_AGENT'${hasUserAgentColumn ? ' OR u."deliveryAgentId" IS NOT NULL' : ''}`);
      const agentIds = agentRows.map((r) => r.id);

      if (agentIds.length) {
        await run(`CREATE TEMP TABLE _removed_agents (id uuid PRIMARY KEY) ON COMMIT DROP`);
        await run(`INSERT INTO _removed_agents (id) VALUES ${agentIds.map((id) => `('${id}')`).join(', ')}`);

        // 2. Their own audit trail goes with them.
        await run(`DELETE FROM audit_logs WHERE "actorId" IN (SELECT id FROM _removed_agents)`);
      }
      await run(`DELETE FROM audit_logs WHERE "entityType" IN (${quoteList(AGENT_ENTITY_TYPES)})`);

      // 3. Every other table that points at users without cascading: clear nullable links,
      //    and keep (as a customer) any agent a required link still needs.
      const keepers = new Set();
      if (agentIds.length) {
        const fks = await rows(`
          SELECT c.conrelid::regclass::text AS tbl, a.attname AS col, a.attnotnull AS required
          FROM pg_constraint c
          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
          WHERE c.contype = 'f' AND c.confrelid = 'users'::regclass
            AND c.confdeltype IN ('a', 'r')
            AND c.conrelid::regclass::text NOT LIKE 'delivery%'`);
        for (const fk of fks) {
          const target = `${fk.tbl} WHERE "${fk.col}" IN (SELECT id FROM _removed_agents)`;
          if (fk.required) {
            const referenced = await rows(`SELECT DISTINCT "${fk.col}" AS id FROM ${target}`);
            referenced.forEach((r) => keepers.add(r.id));
          } else {
            await run(`UPDATE ${target.replace(' WHERE', ` SET "${fk.col}" = NULL WHERE`)}`);
          }
        }
      }

      // 4. Agent tables and their enum types.
      for (const table of AGENT_TABLES) {
        await run(`DROP TABLE IF EXISTS "${table}" CASCADE`);
      }
      const enumTypes = await rows(`
        SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = current_schema() AND t.typtype = 'e' AND t.typname LIKE 'enum\\_delivery\\_%'`);
      for (const { typname } of enumTypes) {
        await run(`DROP TYPE IF EXISTS "${typname}"`);
      }

      // 5. Agent columns on shared tables.
      for (const name of DROPPED_INDEXES) {
        await run(`DROP INDEX IF EXISTS "${name}"`);
      }
      for (const [table, columns] of Object.entries(DROPPED_COLUMNS)) {
        for (const column of columns) {
          await run(`ALTER TABLE "${table}" DROP COLUMN IF EXISTS "${column}"`);
        }
      }

      // 6. Parcel codes: only sign-in codes remain.
      const purposes = (
        await rows(`SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
                    WHERE t.typname = 'enum_otp_codes_purpose'`)
      ).map((r) => r.enumlabel);
      if (purposes.some((p) => p !== 'LOGIN')) {
        await run(`DELETE FROM otp_codes WHERE purpose::text <> 'LOGIN'`);
        await run(`ALTER TYPE "enum_otp_codes_purpose" RENAME TO "enum_otp_codes_purpose_old"`);
        await run(`CREATE TYPE "enum_otp_codes_purpose" AS ENUM ('LOGIN')`);
        await run(`ALTER TABLE otp_codes ALTER COLUMN purpose TYPE "enum_otp_codes_purpose"
                   USING purpose::text::"enum_otp_codes_purpose"`);
        await run(`DROP TYPE "enum_otp_codes_purpose_old"`);
      }

      // 7. Agent notifications.
      await run(`DELETE FROM notification_logs
                 WHERE type IN (${quoteList(AGENT_NOTIFICATION_TYPES)})
                    OR "referenceType" IN (${quoteList(AGENT_ENTITY_TYPES)})`);

      // 8. Agent accounts: delete them, or keep the ones a business record needs as customers.
      if (agentIds.length) {
        const keeperList = [...keepers];
        if (keeperList.length) {
          await run(`UPDATE users SET "roleId" = (SELECT id FROM roles WHERE name = 'CUSTOMER' LIMIT 1)
                     WHERE id IN (${quoteList(keeperList)})`);
        }
        await run(`DELETE FROM users WHERE id IN (SELECT id FROM _removed_agents)
                   ${keeperList.length ? `AND id NOT IN (${quoteList(keeperList)})` : ''}`);
      }

      // 9. The role and its permissions.
      await run(`DELETE FROM "RolePermissions"
                 WHERE "roleId" IN (SELECT id FROM roles WHERE name = 'DELIVERY_AGENT')
                    OR "permissionId" IN (SELECT id FROM permissions WHERE key IN (${quoteList(AGENT_PERMISSIONS)}))`);
      await run(`DELETE FROM permissions WHERE key IN (${quoteList(AGENT_PERMISSIONS)})`);
      await run(`DELETE FROM roles WHERE name = 'DELIVERY_AGENT'
                 AND NOT EXISTS (SELECT 1 FROM users u WHERE u."roleId" = roles.id)`);

      // 10. Agent pay and tax settings.
      await run(`UPDATE platform_settings
                 SET value = value - ARRAY[${quoteList(AGENT_SETTING_KEYS)}]::text[]
                 WHERE jsonb_typeof(value) = 'object' AND value ?| ARRAY[${quoteList(AGENT_SETTING_KEYS)}]::text[]`);

      // 11. Forget migrations whose files no longer exist, so `db:migrate:status` stays clean.
      await run(`DELETE FROM "SequelizeMeta" WHERE name IN (${quoteList(RETIRED_MIGRATIONS)})`);
    });
  },

  async down() {
    // One-way: the agent workflow, its data and its migrations are gone from the codebase,
    // so there is nothing to restore it to.
  },
};

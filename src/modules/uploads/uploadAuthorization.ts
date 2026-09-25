import { ForbiddenError } from '@core/errors/ForbiddenError';
import { ROLES } from '@core/constants/statuses';
import { ERROR_MESSAGES } from '@core/constants/errors';
import { PERMISSIONS, type PermissionKey } from '@core/permissions/permissionKeys';
import { resolvePermissionsForUser } from '@middleware/rbac.middleware';
import { sequelize } from '@config/db';
import { QueryTypes } from 'sequelize';
import {
  S3_ENTITY_TYPES,
  S3_PURPOSES,
  type S3EntityType,
  type S3Purpose,
} from '@core/s3';

type UploadActor = {
  id: string;
  vendorId: string | null;
  deliveryAgentId: string | null;
  role: { name: string };
  roleId: string;
};

async function hasAnyPermission(actor: UploadActor, keys: PermissionKey[]): Promise<boolean> {
  if (actor.role.name === ROLES.SUPER_ADMIN) return true;
  const perms = await resolvePermissionsForUser(actor);
  return keys.some((key) => perms.includes(key));
}

async function productOwnedByVendor(productId: string, vendorId: string): Promise<boolean> {
  const [row] = await sequelize.query<{ vendorId: string | null }>(
    `SELECT "vendorId" FROM products WHERE id = :id AND "deletedAt" IS NULL LIMIT 1`,
    { replacements: { id: productId }, type: QueryTypes.SELECT },
  );
  return Boolean(row && row.vendorId === vendorId);
}

async function productExists(productId: string): Promise<boolean> {
  const [row] = await sequelize.query<{ id: string }>(
    `SELECT id FROM products WHERE id = :id AND "deletedAt" IS NULL LIMIT 1`,
    { replacements: { id: productId }, type: QueryTypes.SELECT },
  );
  return Boolean(row);
}

async function returnAccessibleByUser(returnId: string, userId: string): Promise<boolean> {
  const [row] = await sequelize.query<{ ok: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM return_requests rr
       INNER JOIN sub_orders so ON so.id = rr."subOrderId"
       INNER JOIN orders o ON o.id = so."orderId"
       WHERE rr.id = :returnId
         AND rr."deletedAt" IS NULL
         AND o."userId" = :userId
     ) AS ok`,
    { replacements: { returnId, userId }, type: QueryTypes.SELECT },
  );
  return Boolean(row?.ok);
}

async function returnExists(returnId: string): Promise<boolean> {
  const [row] = await sequelize.query<{ id: string }>(
    `SELECT id FROM return_requests WHERE id = :returnId AND "deletedAt" IS NULL LIMIT 1`,
    { replacements: { returnId }, type: QueryTypes.SELECT },
  );
  return Boolean(row);
}

async function returnAssignedToAgent(returnId: string, deliveryAgentId: string): Promise<boolean> {
  const [row] = await sequelize.query<{ id: string }>(
    `SELECT id FROM return_requests
     WHERE id = :returnId AND "deliveryAgentId" = :deliveryAgentId AND "deletedAt" IS NULL LIMIT 1`,
    { replacements: { returnId, deliveryAgentId }, type: QueryTypes.SELECT },
  );
  return Boolean(row);
}

async function shipmentAssignedToAgent(shipmentId: string, deliveryAgentId: string): Promise<boolean> {
  const [row] = await sequelize.query<{ id: string }>(
    `SELECT id FROM shipments
     WHERE id = :shipmentId AND "deliveryAgentId" = :deliveryAgentId AND "deletedAt" IS NULL LIMIT 1`,
    { replacements: { shipmentId, deliveryAgentId }, type: QueryTypes.SELECT },
  );
  return Boolean(row);
}

async function ticketOwnedByCustomer(ticketId: string, customerId: string): Promise<boolean> {
  const [row] = await sequelize.query<{ id: string }>(
    `SELECT id FROM support_tickets
     WHERE id = :ticketId AND "customerId" = :customerId AND "deletedAt" IS NULL LIMIT 1`,
    { replacements: { ticketId, customerId }, type: QueryTypes.SELECT },
  );
  return Boolean(row);
}

async function ticketRelatedToVendor(ticketId: string, vendorId: string): Promise<boolean> {
  const [row] = await sequelize.query<{ id: string }>(
    `SELECT id FROM support_tickets
     WHERE id = :ticketId AND "relatedVendorId" = :vendorId AND "deletedAt" IS NULL LIMIT 1`,
    { replacements: { ticketId, vendorId }, type: QueryTypes.SELECT },
  );
  return Boolean(row);
}

async function ticketExists(ticketId: string): Promise<boolean> {
  const [row] = await sequelize.query<{ id: string }>(
    `SELECT id FROM support_tickets WHERE id = :ticketId AND "deletedAt" IS NULL LIMIT 1`,
    { replacements: { ticketId }, type: QueryTypes.SELECT },
  );
  return Boolean(row);
}

async function bugReportOwnedByReporter(bugReportId: string, reporterId: string): Promise<boolean> {
  const [row] = await sequelize.query<{ id: string }>(
    `SELECT id FROM bug_reports
     WHERE id = :bugReportId AND "reporterId" = :reporterId AND "deletedAt" IS NULL LIMIT 1`,
    { replacements: { bugReportId, reporterId }, type: QueryTypes.SELECT },
  );
  return Boolean(row);
}

async function bugReportExists(bugReportId: string): Promise<boolean> {
  const [row] = await sequelize.query<{ id: string }>(
    `SELECT id FROM bug_reports WHERE id = :bugReportId AND "deletedAt" IS NULL LIMIT 1`,
    { replacements: { bugReportId }, type: QueryTypes.SELECT },
  );
  return Boolean(row);
}

/** KYC objects are private — no public CDN access. */
export function isPrivateUploadPurpose(purpose: S3Purpose): boolean {
  return purpose === S3_PURPOSES.KYC;
}

/**
 * Ensures the authenticated user may Phase-1 upload under the given entity prefix.
 * Draft entityIds (no DB row yet) are allowed when the role matches the upload intent.
 */
export async function assertUploadAllowed(
  actor: UploadActor,
  entityType: S3EntityType,
  entityId: string,
  purpose: S3Purpose,
): Promise<void> {
  if (actor.role.name === ROLES.SUPER_ADMIN) return;

  switch (entityType) {
    case S3_ENTITY_TYPES.USERS: {
      if (purpose !== S3_PURPOSES.AVATAR || entityId !== actor.id) {
        throw new ForbiddenError(ERROR_MESSAGES.UPLOAD_FORBIDDEN);
      }
      return;
    }

    case S3_ENTITY_TYPES.VENDORS: {
      const isOwner = Boolean(actor.vendorId && actor.vendorId === entityId);
      const canManage = await hasAnyPermission(actor, [
        PERMISSIONS.VENDOR_MANAGE,
        PERMISSIONS.VENDOR_APPROVE,
      ]);
      if (!isOwner && !canManage) {
        throw new ForbiddenError(ERROR_MESSAGES.UPLOAD_FORBIDDEN);
      }
      return;
    }

    case S3_ENTITY_TYPES.PRODUCTS: {
      const allowedProductPurposes: S3Purpose[] = [
        S3_PURPOSES.IMAGES,
        S3_PURPOSES.VIDEO,
        S3_PURPOSES.SIZE_CHART,
      ];
      if (!allowedProductPurposes.includes(purpose)) {
        throw new ForbiddenError(ERROR_MESSAGES.UPLOAD_FORBIDDEN);
      }
      const canManageProducts = await hasAnyPermission(actor, [PERMISSIONS.PRODUCT_MANAGE]);
      if (canManageProducts) return;

      const canVendorUpload = await hasAnyPermission(actor, [
        PERMISSIONS.PRODUCT_CREATE,
        PERMISSIONS.PRODUCT_UPDATE,
      ]);
      if (!canVendorUpload || !actor.vendorId) {
        throw new ForbiddenError(ERROR_MESSAGES.UPLOAD_FORBIDDEN);
      }

      const owned = await productOwnedByVendor(entityId, actor.vendorId);
      if (owned) return;

      const exists = await productExists(entityId);
      if (!exists) {
        // Draft product id before create — vendor Phase-1 gallery uploads.
        return;
      }

      throw new ForbiddenError(ERROR_MESSAGES.UPLOAD_FORBIDDEN);
    }

    case S3_ENTITY_TYPES.CATEGORIES: {
      if (
        purpose !== S3_PURPOSES.IMAGE ||
        !(await hasAnyPermission(actor, [PERMISSIONS.CATEGORY_MANAGE]))
      ) {
        throw new ForbiddenError(ERROR_MESSAGES.UPLOAD_FORBIDDEN);
      }
      return;
    }

    case S3_ENTITY_TYPES.BANNERS: {
      if (
        purpose !== S3_PURPOSES.IMAGE ||
        !(await hasAnyPermission(actor, [PERMISSIONS.BANNER_MANAGE]))
      ) {
        throw new ForbiddenError(ERROR_MESSAGES.UPLOAD_FORBIDDEN);
      }
      return;
    }

    case S3_ENTITY_TYPES.RETURNS: {
      if (purpose !== S3_PURPOSES.PHOTOS) {
        throw new ForbiddenError(ERROR_MESSAGES.UPLOAD_FORBIDDEN);
      }
      const canAdmin = await hasAnyPermission(actor, [PERMISSIONS.ORDER_REFUND]);
      if (canAdmin) return;

      if (actor.deliveryAgentId && await returnAssignedToAgent(entityId, actor.deliveryAgentId)) {
        return;
      }

      const accessible = await returnAccessibleByUser(entityId, actor.id);
      if (accessible) return;

      const exists = await returnExists(entityId);
      if (!exists) {
        // Draft return id before create — customer Phase-1 photo uploads.
        return;
      }

      throw new ForbiddenError(ERROR_MESSAGES.UPLOAD_FORBIDDEN);
    }

    case S3_ENTITY_TYPES.REPORTS: {
      if (purpose !== S3_PURPOSES.EXPORT || entityId !== actor.id) {
        throw new ForbiddenError(ERROR_MESSAGES.UPLOAD_FORBIDDEN);
      }
      return;
    }

    case S3_ENTITY_TYPES.TICKETS: {
      if (purpose !== S3_PURPOSES.ATTACHMENTS) {
        throw new ForbiddenError(ERROR_MESSAGES.UPLOAD_FORBIDDEN);
      }
      const canManage = await hasAnyPermission(actor, [PERMISSIONS.TICKET_MANAGE]);
      if (canManage) return;

      const owned = await ticketOwnedByCustomer(entityId, actor.id);
      if (owned) return;

      if (actor.vendorId) {
        const vendorScoped = await ticketRelatedToVendor(entityId, actor.vendorId);
        if (vendorScoped) return;
      }

      const exists = await ticketExists(entityId);
      if (!exists) {
        // Draft ticket id before create — authenticated Phase-1 attachment uploads.
        return;
      }

      throw new ForbiddenError(ERROR_MESSAGES.UPLOAD_FORBIDDEN);
    }

    case S3_ENTITY_TYPES.BUG_REPORTS: {
      if (purpose !== S3_PURPOSES.ATTACHMENTS) {
        throw new ForbiddenError(ERROR_MESSAGES.UPLOAD_FORBIDDEN);
      }
      const canManage = await hasAnyPermission(actor, [PERMISSIONS.BUG_REPORT_MANAGE]);
      if (canManage) return;

      const owned = await bugReportOwnedByReporter(entityId, actor.id);
      if (owned) return;

      const exists = await bugReportExists(entityId);
      if (!exists) {
        // Draft bug-report id before create — authenticated Phase-1 attachment uploads.
        return;
      }

      throw new ForbiddenError(ERROR_MESSAGES.UPLOAD_FORBIDDEN);
    }

    case S3_ENTITY_TYPES.PAYOUTS: {
      if (
        purpose !== S3_PURPOSES.ATTACHMENTS ||
        !(await hasAnyPermission(actor, [PERMISSIONS.PAYOUT_MANAGE, PERMISSIONS.DELIVERY_AGENT_MANAGE]))
      ) {
        throw new ForbiddenError(ERROR_MESSAGES.UPLOAD_FORBIDDEN);
      }
      return;
    }

    case S3_ENTITY_TYPES.DELIVERY_AGENT_DOCUMENTS: {
      if (purpose !== S3_PURPOSES.KYC) {
        throw new ForbiddenError(ERROR_MESSAGES.UPLOAD_FORBIDDEN);
      }
      if (await hasAnyPermission(actor, [PERMISSIONS.DELIVERY_AGENT_MANAGE])) return;
      if (actor.deliveryAgentId && actor.deliveryAgentId === entityId) return;
      throw new ForbiddenError(ERROR_MESSAGES.UPLOAD_FORBIDDEN);
    }

    case S3_ENTITY_TYPES.SHIPMENTS: {
      if (purpose !== S3_PURPOSES.PROOF) {
        throw new ForbiddenError(ERROR_MESSAGES.UPLOAD_FORBIDDEN);
      }
      if (await hasAnyPermission(actor, [PERMISSIONS.DELIVERY_AGENT_MANAGE])) return;
      if (
        actor.deliveryAgentId &&
        await shipmentAssignedToAgent(entityId, actor.deliveryAgentId)
      ) {
        return;
      }
      throw new ForbiddenError(ERROR_MESSAGES.UPLOAD_FORBIDDEN);
    }

    default:
      throw new ForbiddenError(ERROR_MESSAGES.UPLOAD_FORBIDDEN);
  }
}

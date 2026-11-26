import { AppError } from '@core/errors/AppError';
import { ERROR_CODES, ERROR_MESSAGES } from '@core/constants/errors';
import { AuditLog } from '@database/models/auditLog.model';
import { Op } from 'sequelize';
import { ADMIN_NOTE_LIMITS } from '@core/constants/product';
import { ON_BEHALF_ACTIONS } from './productChangeAudit';

/**
 * Maker-checker: whoever created a product, changed it on the vendor's behalf, or submitted it for
 * them cannot also approve it. Judged from the audit trail (every such action is recorded there), so
 * it holds however many admins touched the listing.
 *
 * A Super Admin may approve their own work by giving a written reason (`ownWorkReason`; the caller only
 * passes it for a Super Admin). Returns true when that override was used, so it can be audited.
 */
export async function assertApproverIndependent(
  product: { id: string; createdBy?: string | null; listedByPlatform?: boolean | null },
  approverId: string,
  ownWorkReason?: string,
): Promise<boolean> {
  const refuse = () => {
    if (ownWorkReason && ownWorkReason.trim().length >= ADMIN_NOTE_LIMITS.MIN) return true;
    throw new AppError(ERROR_MESSAGES.PRODUCT_APPROVER_NOT_INDEPENDENT, 403, ERROR_CODES.PRODUCT_APPROVER_NOT_INDEPENDENT);
  };
  if (product.listedByPlatform && product.createdBy === approverId) return refuse();
  const touched = await AuditLog.count({
    where: {
      entityType: 'Product',
      entityId: product.id,
      actorId: approverId,
      action: { [Op.in]: [...ON_BEHALF_ACTIONS] },
    },
  });
  return touched > 0 ? refuse() : false;
}

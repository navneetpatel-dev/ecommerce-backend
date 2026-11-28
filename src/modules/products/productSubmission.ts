import { NotFoundError } from '@core/errors/NotFoundError';
import { ValidationError } from '@core/errors/ValidationError';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { PRODUCT_STATUS } from '@core/constants/statuses';
import { ERROR_MESSAGES } from '@core/constants/errors';
import { ProductVariant } from '@database/models/productVariant.model';
import { ProductImage } from '@database/models/productImage.model';
import { ProductCategory } from '@database/models/productCategory.model';
import { User } from '@database/models/user.model';
import { sequelize } from '@database/models';
import { notificationsService } from '@modules/notifications/notifications.service';
import { vendorsService } from '@modules/vendors/vendors.service';
import { settingsService } from '@modules/settings/settings.service';
import { logAudit } from '@modules/audit/audit.service';
import { productsRepository } from './products.repository';

/**
 * A vendor submits a draft, or resubmits a listing the moderator rejected: it must be complete
 * (a variant, an image, KYC-approved categories), then it waits in the moderation queue. A first
 * submission goes live at once when the platform's "auto-approve products" setting is on; a
 * resubmission always goes back to a moderator.
 *
 * `onBehalf` is the platform submitting a listing it prepared for the vendor: the vendor's consent is
 * recorded and the auto-approve switch never applies (a different admin approves).
 */
export async function submitProductForApproval(
  service: { getProductById(id: string): Promise<{ id: string; name: string }> },
  id: string,
  vendorId: string | null,
  actorId?: string,
  onBehalf?: { consentNote: string },
) {
  // The platform's "auto-approve products" switch: a first submission that passes every check
  // goes straight live instead of waiting in the moderation queue.
  const autoApproveOn = !onBehalf && (await settingsService.getPlatformSettings()).autoApproveProducts === true;
  let autoApprove = false;
  let ownerVendorId = vendorId;
  await sequelize.transaction(async (t) => {
    const product = await productsRepository.findById(id, { transaction: t });
    if (!product) throw new NotFoundError('Product');

    if (onBehalf) {
      if (!product.listedByPlatform || !product.vendorId) throw new ForbiddenError(ERROR_MESSAGES.PRODUCT_NOT_PLATFORM_LISTED);
      ownerVendorId = product.vendorId;
    } else if (!vendorId || product.vendorId !== vendorId) {
      throw new ForbiddenError(ERROR_MESSAGES.NOT_YOUR_PRODUCT);
    }

    const resubmission = product.status === PRODUCT_STATUS.REJECTED;
    if (product.status !== PRODUCT_STATUS.DRAFT && !resubmission) {
      throw new ValidationError(ERROR_MESSAGES.PRODUCT_NOT_DRAFT);
    }
    autoApprove = autoApproveOn && !resubmission;

    const variantCount = await ProductVariant.count({ where: { productId: id }, transaction: t });
    if (variantCount === 0) {
      throw new ValidationError('Cannot submit product for approval without at least one variant.');
    }

    const imageCount = await ProductImage.count({ where: { productId: id }, transaction: t });
    if (imageCount === 0) {
      throw new ValidationError('Cannot submit product for approval without at least one image.');
    }

    const secondary = await ProductCategory.findAll({
      where: { productId: id },
      attributes: ['categoryId'],
      transaction: t,
    });
    const categoryIds = [
      product.categoryId,
      ...secondary.map((row) => row.categoryId),
    ].filter(Boolean);
    if (ownerVendorId) await vendorsService.assertCategoriesKycSatisfied(ownerVendorId, categoryIds);

    await productsRepository.update(
      id,
      autoApprove
        ? { status: PRODUCT_STATUS.LIVE, approvedById: null, rejectionNote: null }
        : {
            status: PRODUCT_STATUS.PENDING_APPROVAL,
            rejectionNote: null,
            ...(onBehalf && { vendorConsentNote: onBehalf.consentNote, ...(actorId && { updatedBy: actorId }) }),
          },
      { transaction: t },
    );
  });

  const submitted = await service.getProductById(id);
  if (autoApprove) {
    if (actorId) {
      await logAudit({
        actorId,
        action: 'PRODUCT_AUTO_APPROVED',
        entityType: 'Product',
        entityId: id,
        metadata: { name: submitted.name },
      });
    }
    if (ownerVendorId) void User.findAll({ where: { vendorId: ownerVendorId }, attributes: ['id'] })
      .then((vendorUsers) => {
        for (const vendorUser of vendorUsers) {
          void notificationsService.sendProductApproved(vendorUser.id, submitted.id, {
            productName: submitted.name,
          });
        }
      })
      .catch(() => {});
  }
  return submitted;
}

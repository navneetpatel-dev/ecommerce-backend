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
 * A vendor submits a draft: it must be complete (a variant, an image, KYC-approved
 * categories), then it waits in the moderation queue, or goes live at once when the
 * platform's "auto-approve products" setting is on.
 *
 * `onBehalf` is the platform submitting a draft it listed for the vendor: the vendor's consent is recorded,
 * a rejected draft may go again, and the auto-approve switch never applies (a different admin approves).
 * `platformOwned` is a Super Admin publishing the platform's own product (no vendor): it goes live at once.
 */
export async function submitProductForApproval(
  service: { getProductById(id: string): Promise<{ id: string; name: string }> },
  id: string,
  vendorId: string | null,
  actorId?: string,
  onBehalf?: { consentNote: string },
  platformOwned = false,
) {
  // The platform's "auto-approve products" switch: a submission that passed every check
  // above goes straight live instead of waiting in the moderation queue.
  const autoApprove =
    platformOwned || (!onBehalf && (await settingsService.getPlatformSettings()).autoApproveProducts === true);
  let ownerVendorId = vendorId;
  await sequelize.transaction(async (t) => {
    const product = await productsRepository.findById(id, { transaction: t });
    if (!product) throw new NotFoundError('Product');

    if (platformOwned) {
      if (product.vendorId) throw new ForbiddenError(ERROR_MESSAGES.PRODUCT_NOT_PLATFORM_OWNED);
    } else if (onBehalf) {
      if (!product.listedByPlatform || !product.vendorId) throw new ForbiddenError(ERROR_MESSAGES.PRODUCT_NOT_PLATFORM_LISTED);
      ownerVendorId = product.vendorId;
    } else if (product.vendorId !== vendorId) {
      throw new ForbiddenError(ERROR_MESSAGES.NOT_YOUR_PRODUCT);
    }

    const resubmittable = onBehalf && product.status === PRODUCT_STATUS.REJECTED;
    if (product.status !== PRODUCT_STATUS.DRAFT && !resubmittable) {
      throw new ValidationError(ERROR_MESSAGES.PRODUCT_NOT_DRAFT);
    }

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
        ? { status: PRODUCT_STATUS.LIVE, approvedById: platformOwned ? (actorId ?? null) : null, rejectionNote: null }
        : {
            status: PRODUCT_STATUS.PENDING_APPROVAL,
            ...(onBehalf && { vendorConsentNote: onBehalf.consentNote, rejectionNote: null, ...(actorId && { updatedBy: actorId }) }),
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
        metadata: { name: submitted.name, ...(platformOwned && { platformOwned: true }) },
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

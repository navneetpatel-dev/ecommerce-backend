import { ForbiddenError } from '@core/errors/ForbiddenError';
import { logAudit } from '@modules/audit/audit.service';
import { AppError } from '@core/errors/AppError';
import { NotFoundError } from '@core/errors/NotFoundError';
import { ERROR_CODES, ERROR_MESSAGES } from '@core/constants/errors';
import { VENDOR_STATUS } from '@core/constants/statuses';
import { Vendor } from '@database/models/vendor.model';
import { productsService } from './products.service';
import { productsRepository } from './products.repository';
import { submitProductForApproval } from './productSubmission';
import { auditOnBehalf, notifyListed, notifySubmitted } from './productChangeAudit';
import type { CreateProductOnBehalfRequest } from './products.dto';

/**
 * The platform lists a product for an approved vendor. It starts as a draft the vendor can see, edit and
 * submit themselves; nothing is published until a different admin approves it.
 */
export async function createProductOnBehalf(actorId: string, dto: CreateProductOnBehalfRequest, isSuperAdmin = false) {
  if (!dto.vendorId) {
    // The platform's own product: no vendor to act for, so only a Super Admin may create it.
    if (!isSuperAdmin) throw new ForbiddenError(ERROR_MESSAGES.PRODUCT_PLATFORM_OWNED_SUPER_ADMIN_ONLY);
    const own = await productsService.createProduct(null, dto.product, { actorId });
    await logAudit({ actorId, action: 'PRODUCT_CREATED_BY_PLATFORM', entityType: 'Product', entityId: own.id, metadata: { name: own.name } });
    return own;
  }
  const vendor = await Vendor.findByPk(dto.vendorId);
  if (!vendor || vendor.status !== VENDOR_STATUS.APPROVED) {
    throw new AppError(ERROR_MESSAGES.VENDOR_UNAVAILABLE, 422, ERROR_CODES.VENDOR_UNAVAILABLE);
  }
  const product = await productsService.createProduct(dto.vendorId, dto.product, { actorId, listedByPlatform: true });
  await auditOnBehalf({ actorId, action: 'PRODUCT_CREATED_ON_BEHALF', productId: product.id, vendorId: dto.vendorId, name: product.name });
  void notifyListed(dto.vendorId, product.id, product.name);
  return product;
}

/** The platform submits a product it listed, recording how the vendor agreed. Always waits for a different admin's approval. */
export async function submitProductOnBehalf(actorId: string, productId: string, consentNote: string) {
  const product = await productsRepository.findById(productId);
  if (!product) throw new NotFoundError('Product');
  const submitted = await submitProductForApproval(productsService, productId, null, actorId, { consentNote });
  await auditOnBehalf({
    actorId,
    action: 'PRODUCT_SUBMITTED_ON_BEHALF',
    productId,
    vendorId: product.vendorId!,
    name: submitted.name,
    metadata: { consentNote },
  });
  void notifySubmitted(product.vendorId!, productId, submitted.name, consentNote);
  return submitted;
}

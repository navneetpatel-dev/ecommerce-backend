import { Op, type Transaction } from 'sequelize';
import { AppError } from '@core/errors/AppError';
import { NotFoundError } from '@core/errors/NotFoundError';
import { ValidationError } from '@core/errors/ValidationError';
import { ERROR_CODES, ERROR_MESSAGES } from '@core/constants/errors';
import { PRODUCT_STATUS } from '@core/constants/statuses';
import { sequelize } from '@database/models';
import { Product } from '@database/models/product.model';
import { ProductCategory } from '@database/models/productCategory.model';
import { Vendor } from '@database/models/vendor.model';
import { areCategoryDocumentsSatisfied } from '@modules/vendors/documentRequirements';
import { categoriesRepository } from './categories.repository';
import { categoriesService } from './categories.service';

export type ReassignBlocker = { vendorId: string; businessName: string; products: number };

/**
 * Vendors who may not sell in the target category (missing verified documents) and have live or
 * pending products in the source: moving those would put them on sale there unverified.
 */
export async function reassignBlockers(
  fromCategoryId: string,
  toCategoryId: string,
  transaction?: Transaction,
): Promise<ReassignBlocker[]> {
  const products = await Product.findAll({
    where: {
      categoryId: fromCategoryId,
      status: { [Op.in]: [PRODUCT_STATUS.LIVE, PRODUCT_STATUS.PENDING_APPROVAL] },
      vendorId: { [Op.ne]: null },
    },
    attributes: ['vendorId'],
    include: [{ model: Vendor, as: 'vendor', attributes: ['businessName', 'entityType'] }],
    transaction,
  });
  const byVendor = new Map<string, { vendor: Vendor | undefined; products: number }>();
  for (const product of products) {
    const entry = byVendor.get(product.vendorId!);
    const vendor = (product as Product & { vendor?: Vendor }).vendor;
    byVendor.set(product.vendorId!, { vendor, products: (entry?.products ?? 0) + 1 });
  }
  const blockers: ReassignBlocker[] = [];
  for (const [vendorId, { vendor, products: count }] of byVendor) {
    if (await areCategoryDocumentsSatisfied(vendorId, vendor?.entityType, [toCategoryId])) continue;
    blockers.push({ vendorId, businessName: vendor?.businessName ?? vendorId, products: count });
  }
  return blockers;
}

/**
 * Moves every product of one category to another, deleted ones included (they would otherwise keep
 * the category from ever being deleted). All or nothing: refused while any vendor is blocked.
 */
export async function reassignProducts(fromCategoryId: string, toCategoryId: string) {
  if (fromCategoryId === toCategoryId) throw new ValidationError(ERROR_MESSAGES.CATEGORY_REASSIGN_SAME);
  return sequelize.transaction(async (t) => {
    await categoriesService.assertActiveCategory(toCategoryId, t);
    if (!(await categoriesRepository.findById(fromCategoryId, { transaction: t }))) throw new NotFoundError('Category');

    const vendors = await reassignBlockers(fromCategoryId, toCategoryId, t);
    if (vendors.length > 0) {
      // `details.vendors` names who is blocked and how many products each has.
      throw new AppError(ERROR_MESSAGES.CATEGORY_REASSIGN_KYC_BLOCKED, 422, ERROR_CODES.CATEGORY_REASSIGN_KYC_BLOCKED, { vendors });
    }

    const moved = await Product.findAll({
      where: { categoryId: fromCategoryId },
      attributes: ['id', 'deletedAt'],
      paranoid: false,
      transaction: t,
    });
    await Product.update(
      { categoryId: toCategoryId },
      { where: { categoryId: fromCategoryId }, paranoid: false, transaction: t },
    );
    // A product tagged with the new primary category as a secondary one would list it twice.
    await ProductCategory.destroy({
      where: { productId: { [Op.in]: moved.map((product) => product.id) }, categoryId: toCategoryId },
      force: true,
      transaction: t,
    });
    return { fromCategoryId, toCategoryId, updatedCount: moved.filter((product) => !product.deletedAt).length };
  });
}

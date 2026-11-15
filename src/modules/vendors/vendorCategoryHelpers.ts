import { Op, type Transaction } from 'sequelize';
import { Category } from '@database/models/category.model';
import { VendorCategory } from '@database/models/vendorCategory.model';
import { ValidationError } from '@core/errors/ValidationError';
import { ERROR_MESSAGES } from '@core/constants/errors';

export function generateSlug(businessName: string): string {
  return businessName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export function normalizeName(value: string | undefined | null): string {
  return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function detectNameMismatch(
  panHolderName?: string,
  bankAccountHolderName?: string,
): boolean {
  const pan = normalizeName(panHolderName);
  const bank = normalizeName(bankAccountHolderName);
  if (!pan || !bank) return false;
  return pan !== bank;
}

export async function assertCategoriesExist(categoryIds: string[], transaction?: Transaction) {
  const rows = await Category.findAll({
    where: { id: { [Op.in]: categoryIds } },
    attributes: ['id'],
    transaction,
  });
  if (rows.length !== categoryIds.length) {
    throw new ValidationError({ categoryIds: [ERROR_MESSAGES.VENDOR_CATEGORIES_INVALID] });
  }
}

export async function syncVendorCategories(
  vendorId: string,
  categoryIds: string[],
  transaction: Transaction,
) {
  await VendorCategory.destroy({ where: { vendorId }, transaction, force: true });
  if (categoryIds.length === 0) return;
  await VendorCategory.bulkCreate(
    categoryIds.map((categoryId) => ({ vendorId, categoryId })),
    { transaction },
  );
}

export async function getVendorCategoryIds(vendorId: string, transaction?: Transaction) {
  const links = await VendorCategory.findAll({
    where: { vendorId },
    attributes: ['categoryId'],
    transaction,
  });
  return links.map((link) => link.categoryId);
}

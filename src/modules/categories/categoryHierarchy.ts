import { NotFoundError } from '@core/errors/NotFoundError';
import { ValidationError } from '@core/errors/ValidationError';
import { ERROR_MESSAGES } from '@core/constants/errors';
import { Category } from '@database/models/category.model';
import type { Transaction } from 'sequelize';
import { categoriesRepository } from './categories.repository';

/** The deepest a category tree may go (top level counts as 1). */
export const MAX_CATEGORY_DEPTH = 3;

export async function getCategoryDepth(categoryId: string | null, transaction?: Transaction): Promise<number> {
  if (!categoryId) return 0;
  let depth = 0;
  let cursor: string | null = categoryId;
  const seen = new Set<string>();
  while (cursor) {
    if (seen.has(cursor)) throw new ValidationError(ERROR_MESSAGES.CATEGORY_INVALID_PARENT);
    seen.add(cursor);
    depth += 1;
    const node = await categoriesRepository.findById(cursor, { transaction });
    if (!node) throw new NotFoundError('Parent category');
    cursor = node.parentId;
  }
  return depth;
}

/** Height of a subtree rooted at categoryId (leaf = 1). */
export async function getSubtreeHeight(categoryId: string, transaction?: Transaction): Promise<number> {
  const children = await Category.findAll({
    where: { parentId: categoryId },
    attributes: ['id'],
    transaction,
  });
  if (!children.length) return 1;
  let maxChild = 0;
  for (const child of children) {
    maxChild = Math.max(maxChild, await getSubtreeHeight(child.id, transaction));
  }
  return 1 + maxChild;
}

export async function assertValidParent(
  categoryId: string | null,
  parentId: string,
  transaction: Transaction,
) {
  if (categoryId && parentId === categoryId) {
    throw new ValidationError(ERROR_MESSAGES.CATEGORY_INVALID_PARENT);
  }

  let cursor: string | null = parentId;
  const seen = new Set<string>(categoryId ? [categoryId] : []);

  while (cursor) {
    if (seen.has(cursor)) {
      throw new ValidationError(ERROR_MESSAGES.CATEGORY_INVALID_PARENT);
    }
    seen.add(cursor);
    const node = await categoriesRepository.findById(cursor, { transaction });
    if (!node) throw new NotFoundError('Parent category');
    cursor = node.parentId;
  }

  const parentDepth = await getCategoryDepth(parentId, transaction);
  const subtreeHeight = categoryId ? await getSubtreeHeight(categoryId, transaction) : 1;
  if (parentDepth + subtreeHeight > MAX_CATEGORY_DEPTH) {
    throw new ValidationError(ERROR_MESSAGES.CATEGORY_MAX_DEPTH);
  }
}


import { Op, fn, col, where, type Transaction } from 'sequelize';
import { ValidationError } from '@core/errors/ValidationError';
import { ERROR_MESSAGES } from '@core/constants/errors';
import { Category } from '@database/models/category.model';

/** Categories under the same parent have different names, whatever the capitals. */
export async function assertSiblingNameFree(
  name: string,
  parentId: string | null,
  excludeId: string | null,
  transaction: Transaction,
): Promise<void> {
  const taken = await Category.count({
    where: {
      parentId,
      ...(excludeId ? { id: { [Op.ne]: excludeId } } : {}),
      [Op.and]: [where(fn('lower', col('name')), name.trim().toLowerCase())],
    },
    transaction,
  });
  if (taken > 0) throw new ValidationError(ERROR_MESSAGES.CATEGORY_NAME_TAKEN_HERE);
}

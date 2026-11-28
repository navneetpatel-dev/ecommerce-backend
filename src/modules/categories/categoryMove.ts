import { NotFoundError } from '@core/errors/NotFoundError';
import { ValidationError } from '@core/errors/ValidationError';
import { ERROR_MESSAGES } from '@core/constants/errors';
import { Category } from '@database/models/category.model';
import { sequelize } from '@database/models';
import { categoriesRepository } from './categories.repository';
import { assertAncestorsActive, assertValidParent } from './categoryHierarchy';
import { CATEGORY_STATUS } from '@core/constants/statuses';
import { assertSiblingNameFree } from './categoryNames';

/** Where a moved category goes among its new siblings: before or after one of them, else last. */
export function placeAmongSiblings(
  siblingIds: string[],
  movedId: string,
  anchor: { beforeId?: string; afterId?: string },
): string[] | null {
  const others = siblingIds.filter((id) => id !== movedId);
  const anchorId = anchor.beforeId ?? anchor.afterId;
  if (anchorId === undefined) return [...others, movedId];
  const index = others.indexOf(anchorId);
  if (index === -1) return null;
  const at = anchor.beforeId ? index : index + 1;
  return [...others.slice(0, at), movedId, ...others.slice(at)];
}

/**
 * Moves a category under another parent and/or to a place among its siblings, renumbering only that
 * sibling group (so pages and other parents never interfere). One transaction; the parent is checked
 * for cycles and depth like any other parent change.
 */
export async function moveCategory(
  id: string,
  input: { parentId?: string | null; beforeId?: string; afterId?: string },
) {
  return sequelize.transaction(async (t) => {
    const category = await categoriesRepository.findById(id, { transaction: t });
    if (!category) throw new NotFoundError('Category');

    const parentId = input.parentId !== undefined ? input.parentId : category.parentId;
    const reparented = (parentId ?? null) !== (category.parentId ?? null);
    if (reparented && parentId) {
      await assertValidParent(id, parentId, t);
      if (category.status === CATEGORY_STATUS.ACTIVE) await assertAncestorsActive(parentId, t);
    }

    if (reparented) await assertSiblingNameFree(category.name, parentId ?? null, id, t);

    const siblings = await Category.findAll({
      where: { parentId: parentId ?? null },
      attributes: ['id', 'name', 'displayOrder'],
      transaction: t,
    });
    const ordered = siblings
      .sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || a.id.localeCompare(b.id))
      .map((row) => row.id);
    const placed = placeAmongSiblings(ordered, id, input);
    if (!placed) throw new ValidationError(ERROR_MESSAGES.CATEGORY_MOVE_ANCHOR_INVALID);

    const current = new Map(siblings.map((row) => [row.id, row.displayOrder]));
    for (let index = 0; index < placed.length; index += 1) {
      const rowId = placed[index]!;
      const changed = current.get(rowId) !== index || rowId === id;
      if (changed) {
        await categoriesRepository.update(
          rowId,
          rowId === id ? { displayOrder: index, parentId: parentId ?? null } : { displayOrder: index },
          { transaction: t },
        );
      }
    }
    return { id, parentId: parentId ?? null, orderedIds: placed, reparented };
  });
}

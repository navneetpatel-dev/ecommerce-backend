import { Op, type Transaction } from 'sequelize';
import { CategoryAttribute } from '@database/models/categoryAttribute.model';
import { categoriesService } from './categories.service';

/**
 * A variant's option names spelt as the category's filters spell them ("colour" becomes
 * "Colour"), so that what a vendor types matches the attribute shoppers filter by. Names the
 * category (and those above it) does not define are kept as typed.
 */
export async function canonicalAttributeKeys(
  categoryId: string,
  attributes: Record<string, string>,
  transaction?: Transaction,
): Promise<Record<string, string>> {
  if (Object.keys(attributes).length === 0) return attributes;
  const chain = await categoriesService.walkCategoryAncestors(categoryId, transaction);
  if (chain.length === 0) return attributes;
  const defined = await CategoryAttribute.findAll({
    where: { categoryId: { [Op.in]: chain.map((category) => category.id) } },
    attributes: ['name', 'categoryId'],
    transaction,
  });
  // The nearest category's spelling wins.
  const spelling = new Map<string, string>();
  for (const category of [...chain].reverse()) {
    for (const attribute of defined.filter((row) => row.categoryId === category.id)) {
      spelling.set(attribute.name.trim().toLowerCase(), attribute.name);
    }
  }
  return Object.fromEntries(
    Object.entries(attributes).map(([name, value]) => [spelling.get(name.trim().toLowerCase()) ?? name, value]),
  );
}

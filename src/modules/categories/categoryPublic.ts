/** Fields of a category that are for the platform team, never for shoppers. */
const INTERNAL_CATEGORY_FIELDS = ['commissionRate', 'createdBy', 'updatedBy', 'deletedBy'] as const;

/**
 * A category as the public API returns it: the commission the platform takes, and who created or
 * changed it, are not for shoppers. Applied to the category and, recursively, its subcategories.
 */
export function toPublicCategory<T extends Record<string, any>>(category: T): T {
  const copy: Record<string, any> = { ...category };
  for (const field of INTERNAL_CATEGORY_FIELDS) delete copy[field];
  if (Array.isArray(copy.children)) copy.children = copy.children.map((child) => toPublicCategory(child));
  if (copy.parent && typeof copy.parent === 'object') copy.parent = toPublicCategory(copy.parent);
  return copy as T;
}

import { CATEGORY_STATUS } from '@core/constants/statuses';
import { buildPaginationMeta, paginationOffset } from '@core/http/pagination';
import { Category } from '@database/models/category.model';
import { taxService } from '@modules/tax/tax.service';

type Gst = { gstPercentage: number; priceBandThreshold: number | null; gstPercentageAbove: number | null };

type PickerCategory = {
  id: string;
  name: string;
  parentId: string | null;
  imageUrl: string | null;
  displayOrder: number;
  status: string;
};

export type CategoryPickerItem = Gst & {
  id: string;
  name: string;
  /** Nesting level in the tree (0 = top level); 0 for search results, which are listed flat. */
  depth: number;
  imageUrl: string | null;
  /** "Home & Kitchen › Cookware": where a search result sits in the tree. */
  path: string | null;
};

const byOrderThenName = (a: PickerCategory, b: PickerCategory) =>
  a.displayOrder - b.displayOrder || a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || a.id.localeCompare(b.id);

/**
 * The categories a product can be filed under, as one ordered list: the tree walked depth first
 * (parents before their children, siblings by display order then name), active categories only.
 * A search returns the matching categories flat, each with its path. Pure: no database access.
 */
export function buildPickerList(
  all: PickerCategory[],
  rates: Map<string, Gst>,
  query: { search?: string; id?: string },
): CategoryPickerItem[] {
  const active = all.filter((category) => category.status === CATEGORY_STATUS.ACTIVE);
  const byId = new Map(all.map((category) => [category.id, category]));
  const activeIds = new Set(active.map((category) => category.id));
  const children = new Map<string | null, PickerCategory[]>();
  for (const category of active) {
    // A category whose parent is not active is shown at the top level so it is not lost.
    const key = category.parentId && activeIds.has(category.parentId) ? category.parentId : null;
    children.set(key, [...(children.get(key) ?? []), category]);
  }
  for (const list of children.values()) list.sort(byOrderThenName);

  const pathOf = (category: PickerCategory): string | null => {
    const names: string[] = [];
    const seen = new Set<string>([category.id]);
    let parent = category.parentId ? byId.get(category.parentId) : undefined;
    while (parent && !seen.has(parent.id)) {
      seen.add(parent.id);
      names.unshift(parent.name);
      parent = parent.parentId ? byId.get(parent.parentId) : undefined;
    }
    return names.length ? names.join(' › ') : null;
  };
  const toItem = (category: PickerCategory, depth: number, path: string | null): CategoryPickerItem => ({
    id: category.id,
    name: category.name,
    depth,
    imageUrl: category.imageUrl,
    path,
    ...(rates.get(category.id) ?? { gstPercentage: 18, priceBandThreshold: null, gstPercentageAbove: null }),
  });

  const ordered: Array<{ category: PickerCategory; depth: number }> = [];
  const visited = new Set<string>();
  const walk = (parentId: string | null, depth: number) => {
    for (const category of children.get(parentId) ?? []) {
      if (visited.has(category.id)) continue;
      visited.add(category.id);
      ordered.push({ category, depth });
      walk(category.id, depth + 1);
    }
  };
  walk(null, 0);

  if (query.id) {
    const found = ordered.find((row) => row.category.id === query.id);
    return found ? [toItem(found.category, found.depth, pathOf(found.category))] : [];
  }
  const term = query.search?.trim().toLowerCase();
  if (term) {
    return ordered
      .filter((row) => row.category.name.toLowerCase().includes(term))
      .map((row) => toItem(row.category, 0, pathOf(row.category)));
  }
  return ordered.map((row) => toItem(row.category, row.depth, null));
}

/** One page of the picker list. Three small queries; the ordering and paging are done in memory. */
export async function listCategoriesForPicker(query: { page: number; limit: number; search?: string; id?: string }) {
  const all = (await Category.findAll({
    attributes: ['id', 'name', 'parentId', 'imageUrl', 'displayOrder', 'status'],
    raw: true,
  })) as unknown as PickerCategory[];
  const rates = new Map(
    (await taxService.categoryGstRates(all)).map((rate) => [
      rate.categoryId,
      { gstPercentage: rate.gstPercentage, priceBandThreshold: rate.priceBandThreshold, gstPercentageAbove: rate.gstPercentageAbove },
    ]),
  );
  const list = buildPickerList(all, rates, query);
  const offset = paginationOffset(query.page, query.limit);
  return {
    categories: list.slice(offset, offset + query.limit),
    pagination: buildPaginationMeta(list.length, query.page, query.limit),
  };
}

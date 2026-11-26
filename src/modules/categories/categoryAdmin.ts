import { fn, col } from 'sequelize';
import { NotFoundError } from '@core/errors/NotFoundError';
import { buildPaginationMeta, paginationOffset } from '@core/http/pagination';
import { Category } from '@database/models/category.model';
import { Product } from '@database/models/product.model';
import { TaxRule } from '@database/models/taxRule.model';
import { loadCategoryRules, type ResolvedCategoryRule } from '@modules/tax/taxRuleResolution';

type AdminRow = {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  imageUrl: string | null;
  status: string;
  displayOrder: number;
  seoTitle: string | null;
  seoDescription: string | null;
  commissionRate: number | string | null;
  returnWindowDays: number | null;
  codEnabled: boolean | null;
  defaultWarrantyMonths: number | null;
  defaultWarrantyType: string | null;
};

export type AdminCategoryItem = Omit<AdminRow, 'commissionRate'> & {
  commissionRate: number | null;
  /** Nesting level in the tree (0 = top level); 0 in search results, which are flat. */
  depth: number;
  /** "Home & Kitchen › Cookware": where a search result sits. */
  path: string | null;
  parent: { id: string; name: string; slug: string } | null;
  childCount: number;
  productCount: number;
  gst: {
    percent: number;
    source: ResolvedCategoryRule['source'];
    fromCategoryName: string | null;
    priceBandThreshold: number | null;
    percentAbove: number | null;
  };
};

const byOrderThenName = (a: AdminRow, b: AdminRow) =>
  a.displayOrder - b.displayOrder || a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || a.id.localeCompare(b.id);

/**
 * The admin category list as one ordered list: the tree walked depth first (parents before children,
 * siblings by display order then name), every status, each with its depth, children, products and
 * the GST it gets and why. A search lists the matches flat with their paths. Pure: no database access.
 */
export function buildAdminCategoryList(
  all: AdminRow[],
  rules: Map<string, ResolvedCategoryRule>,
  productCounts: Map<string, number>,
  query: { search?: string; status?: string; excludeId?: string },
): AdminCategoryItem[] {
  const byId = new Map(all.map((row) => [row.id, row]));
  const children = new Map<string | null, AdminRow[]>();
  for (const row of all) {
    const key = row.parentId && byId.has(row.parentId) ? row.parentId : null;
    children.set(key, [...(children.get(key) ?? []), row]);
  }
  for (const list of children.values()) list.sort(byOrderThenName);

  const pathOf = (row: AdminRow): string | null => {
    const names: string[] = [];
    const seen = new Set<string>([row.id]);
    let parent = row.parentId ? byId.get(row.parentId) : undefined;
    while (parent && !seen.has(parent.id)) {
      seen.add(parent.id);
      names.unshift(parent.name);
      parent = parent.parentId ? byId.get(parent.parentId) : undefined;
    }
    return names.length ? names.join(' › ') : null;
  };
  const toItem = (row: AdminRow, depth: number, path: string | null): AdminCategoryItem => {
    const rule = rules.get(row.id);
    const parent = row.parentId ? byId.get(row.parentId) : undefined;
    const from = rule?.fromCategoryId ? byId.get(rule.fromCategoryId) : undefined;
    return {
      ...row,
      commissionRate: row.commissionRate != null ? Number(row.commissionRate) : null,
      depth,
      path,
      parent: parent ? { id: parent.id, name: parent.name, slug: parent.slug } : null,
      childCount: children.get(row.id)?.length ?? 0,
      productCount: productCounts.get(row.id) ?? 0,
      gst: {
        percent: rule?.gstPercentage ?? 18,
        source: rule?.source ?? 'fallback',
        fromCategoryName: from?.name ?? null,
        priceBandThreshold: rule?.priceBandThreshold ?? null,
        percentAbove: rule?.gstPercentageAbove ?? null,
      },
    };
  };

  const ordered: Array<{ row: AdminRow; depth: number }> = [];
  const visited = new Set<string>();
  const walk = (parentId: string | null, depth: number) => {
    for (const row of children.get(parentId) ?? []) {
      if (visited.has(row.id) || row.id === query.excludeId) continue;
      visited.add(row.id);
      ordered.push({ row, depth });
      walk(row.id, depth + 1);
    }
  };
  walk(null, 0);

  const term = query.search?.trim().toLowerCase();
  return ordered
    .filter(({ row }) => (!query.status || row.status === query.status) && (!term || row.name.toLowerCase().includes(term)))
    .map(({ row, depth }) => (term ? toItem(row, 0, pathOf(row)) : toItem(row, depth, null)));
}

async function loadAdminData() {
  const all = (await Category.findAll({ raw: true })) as unknown as AdminRow[];
  const resolved = await loadCategoryRules(all);
  const counts = (await Product.findAll({
    attributes: ['categoryId', [fn('COUNT', col('id')), 'count']],
    group: ['categoryId'],
    raw: true,
  })) as unknown as Array<{ categoryId: string; count: string }>;
  return {
    all,
    rules: new Map(resolved.map((rule) => [rule.categoryId, rule])),
    productCounts: new Map(counts.map((row) => [row.categoryId, Number(row.count)])),
  };
}

/** One page of the admin category list (see `buildAdminCategoryList`). */
export async function listCategoriesForAdmin(query: {
  page: number;
  limit: number;
  search?: string;
  status?: string;
  excludeId?: string;
}) {
  const { all, rules, productCounts } = await loadAdminData();
  const list = buildAdminCategoryList(all, rules, productCounts, query);
  const offset = paginationOffset(query.page, query.limit);
  return {
    categories: list.slice(offset, offset + query.limit),
    pagination: buildPaginationMeta(list.length, query.page, query.limit),
  };
}

export type CategoryImpact = {
  categoryId: string;
  childCount: number;
  activeChildCount: number;
  productCount: number;
  ownTaxRule: { id: string; gstPercentage: number } | null;
  /** The GST this category would get if its own rule went away (null when it has none of its own). */
  gstAfterRuleRemoved: number | null;
};

/** What archiving or deleting this category would touch, shown before the admin confirms. */
export async function getCategoryImpact(categoryId: string): Promise<CategoryImpact> {
  const { all, rules, productCounts } = await loadAdminData();
  const category = all.find((row) => row.id === categoryId);
  if (!category) throw new NotFoundError('Category');
  const kids = all.filter((row) => row.parentId === categoryId);
  const taxRule = await TaxRule.findOne({ where: { categoryId }, attributes: ['id', 'gstPercentage'] });
  const gst = rules.get(categoryId);
  return {
    categoryId,
    childCount: kids.length,
    activeChildCount: kids.filter((row) => row.status === 'ACTIVE').length,
    productCount: productCounts.get(categoryId) ?? 0,
    ownTaxRule: taxRule ? { id: taxRule.id, gstPercentage: Number(taxRule.gstPercentage) } : null,
    gstAfterRuleRemoved: gst && gst.source === 'own' ? null : (gst?.gstPercentage ?? null),
  };
}

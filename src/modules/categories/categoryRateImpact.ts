import { Op, type Transaction } from 'sequelize';
import { PRODUCT_STATUS } from '@core/constants/statuses';
import { Category } from '@database/models/category.model';
import { Product } from '@database/models/product.model';
import { TaxRule } from '@database/models/taxRule.model';
import { Vendor } from '@database/models/vendor.model';
import { settingsService } from '@modules/settings/settings.service';
import { resolveCategoryRules } from '@modules/tax/taxRuleResolution';

/** A change to where products or categories sit, which can change what is charged on them. */
export type CategoryChange =
  | { kind: 'reassign'; fromCategoryId: string; toCategoryId: string }
  | { kind: 'reparent'; categoryId: string; parentId: string | null };

type Node = { id: string; parentId: string | null; commissionRate: number | string | null };

export type RatedProduct = { id: string; categoryId: string; vendorId: string; businessName: string; vendorRate: number | null };

export type CategoryRateImpact = {
  /** Live or pending vendor products whose GST or commission would change. */
  productCount: number;
  gstChanged: number;
  commissionChanged: number;
  vendors: Array<{ vendorId: string; businessName: string; products: number }>;
};

/** The nearest category commission up the tree, else the vendor's own, else the platform's. */
function commissionFor(tree: Map<string, Node>, categoryId: string, vendorRate: number | null, fallback: number): number {
  const seen = new Set<string>();
  let node = tree.get(categoryId);
  while (node && !seen.has(node.id)) {
    seen.add(node.id);
    if (node.commissionRate != null) return Number(node.commissionRate);
    node = node.parentId ? tree.get(node.parentId) : undefined;
  }
  return vendorRate ?? fallback;
}

/** Which of `products` would be charged differently after `change`. Pure: no database access. */
export function compareCategoryRates(input: {
  products: RatedProduct[];
  categories: Node[];
  rules: Parameters<typeof resolveCategoryRules>[0];
  change: CategoryChange;
  defaultCommission: number;
}): CategoryRateImpact {
  const { products, categories, rules, change, defaultCommission } = input;
  const after =
    change.kind === 'reparent'
      ? categories.map((node) => (node.id === change.categoryId ? { ...node, parentId: change.parentId } : node))
      : categories;
  const gstOf = (tree: Node[]) =>
    new Map(
      resolveCategoryRules(rules, tree).map((rule) => [
        rule.categoryId,
        `${rule.gstPercentage}/${rule.priceBandThreshold}/${rule.gstPercentageAbove}`,
      ]),
    );
  const [gstBefore, gstAfter] = [gstOf(categories), gstOf(after)];
  const [treeBefore, treeAfter] = [categories, after].map((tree) => new Map(tree.map((node) => [node.id, node])));

  const vendors = new Map<string, { vendorId: string; businessName: string; products: number }>();
  const result = { productCount: 0, gstChanged: 0, commissionChanged: 0 };
  for (const product of products) {
    const target = change.kind === 'reassign' ? change.toCategoryId : product.categoryId;
    const gst = gstBefore.get(product.categoryId) !== gstAfter.get(target);
    const commission =
      commissionFor(treeBefore!, product.categoryId, product.vendorRate, defaultCommission) !==
      commissionFor(treeAfter!, target, product.vendorRate, defaultCommission);
    if (!gst && !commission) continue;
    result.productCount += 1;
    if (gst) result.gstChanged += 1;
    if (commission) result.commissionChanged += 1;
    const entry = vendors.get(product.vendorId) ?? { vendorId: product.vendorId, businessName: product.businessName, products: 0 };
    vendors.set(product.vendorId, { ...entry, products: entry.products + 1 });
  }
  return { ...result, vendors: [...vendors.values()] };
}

function subtree(categories: Node[], rootId: string): string[] {
  const ids = new Set([rootId]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const node of categories) {
      if (node.parentId && ids.has(node.parentId) && !ids.has(node.id)) {
        ids.add(node.id);
        grew = true;
      }
    }
  }
  return [...ids];
}

export async function categoryRateImpact(change: CategoryChange, transaction?: Transaction): Promise<CategoryRateImpact> {
  const [categories, rules, settings] = await Promise.all([
    Category.findAll({ attributes: ['id', 'parentId', 'commissionRate'], raw: true, transaction }) as unknown as Promise<Node[]>,
    TaxRule.findAll({ order: [['createdAt', 'ASC'], ['gstPercentage', 'ASC'], ['id', 'ASC']], transaction }),
    settingsService.getPlatformSettings(),
  ]);
  const sources = change.kind === 'reassign' ? [change.fromCategoryId] : subtree(categories, change.categoryId);
  const rows = await Product.findAll({
    where: {
      categoryId: { [Op.in]: sources },
      status: { [Op.in]: [PRODUCT_STATUS.LIVE, PRODUCT_STATUS.PENDING_APPROVAL] },
      vendorId: { [Op.ne]: null },
    },
    attributes: ['id', 'categoryId', 'vendorId'],
    include: [{ model: Vendor, as: 'vendor', attributes: ['businessName', 'commissionRate'] }],
    transaction,
  });
  const products = rows.map((row) => {
    const vendor = (row as Product & { vendor?: Vendor }).vendor;
    return {
      id: row.id,
      categoryId: row.categoryId,
      vendorId: row.vendorId!,
      businessName: vendor?.businessName ?? '',
      vendorRate: vendor?.commissionRate != null ? Number(vendor.commissionRate) : null,
    };
  });
  return compareCategoryRates({ products, categories, rules, change, defaultCommission: Number(settings.defaultCommissionRate) });
}

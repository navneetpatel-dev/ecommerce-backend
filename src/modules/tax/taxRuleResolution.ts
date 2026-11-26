import { Category } from '@database/models/category.model';
import { TaxRule } from '@database/models/taxRule.model';

type RuleShape = Pick<
  TaxRule,
  'id' | 'categoryId' | 'gstPercentage' | 'priceBandThreshold' | 'gstPercentageAbove' | 'hsnCode'
>;

export type RuleSource = 'own' | 'inherited' | 'default' | 'fallback';

export type ResolvedCategoryRule = {
  categoryId: string;
  /** The rule that applies; null when none does (the 18% fallback). */
  ruleId: string | null;
  source: RuleSource;
  /** For `inherited`: the ancestor whose rule applies. */
  fromCategoryId: string | null;
  gstPercentage: number;
  priceBandThreshold: number | null;
  gstPercentageAbove: number | null;
  hsnCode: string | null;
};

const FALLBACK_GST = 18;

const bandOf = (rule: RuleShape) => {
  const threshold = rule.priceBandThreshold != null ? Number(rule.priceBandThreshold) : null;
  const above = rule.gstPercentageAbove != null ? Number(rule.gstPercentageAbove) : null;
  const banded = threshold != null && above != null && threshold > 0;
  return { priceBandThreshold: banded ? threshold : null, gstPercentageAbove: banded ? above : null };
};

/**
 * Which tax rule each category gets, and why: its own, the nearest ancestor's, the platform default,
 * or the 18% fallback. The same walk as `resolveEffectiveTaxRule`, for every category at once, in
 * memory. `rules` must be in the picking order (oldest, then lowest rate): the first rule found for a
 * category (or for the default) wins. Pure: no database access.
 */
export function resolveCategoryRules(
  rules: RuleShape[],
  categories: Array<{ id: string; parentId: string | null }>,
): ResolvedCategoryRule[] {
  const byCategory = new Map<string, RuleShape>();
  let platformDefault: RuleShape | undefined;
  for (const rule of rules) {
    if (rule.categoryId) {
      if (!byCategory.has(rule.categoryId)) byCategory.set(rule.categoryId, rule);
    } else if (!platformDefault) {
      platformDefault = rule;
    }
  }
  const parentOf = new Map(categories.map((category) => [category.id, category.parentId ?? null]));

  return categories.map((category) => {
    const seen = new Set<string>();
    let node: string | null = category.id;
    while (node && !seen.has(node)) {
      seen.add(node);
      const rule = byCategory.get(node);
      if (rule) {
        return {
          categoryId: category.id,
          ruleId: rule.id,
          source: node === category.id ? ('own' as const) : ('inherited' as const),
          fromCategoryId: node === category.id ? null : node,
          gstPercentage: Number(rule.gstPercentage),
          hsnCode: rule.hsnCode ?? null,
          ...bandOf(rule),
        };
      }
      node = parentOf.get(node) ?? null;
    }
    if (platformDefault) {
      return {
        categoryId: category.id,
        ruleId: platformDefault.id,
        source: 'default' as const,
        fromCategoryId: null,
        gstPercentage: Number(platformDefault.gstPercentage),
        hsnCode: platformDefault.hsnCode ?? null,
        ...bandOf(platformDefault),
      };
    }
    return {
      categoryId: category.id,
      ruleId: null,
      source: 'fallback' as const,
      fromCategoryId: null,
      gstPercentage: FALLBACK_GST,
      hsnCode: null,
      priceBandThreshold: null,
      gstPercentageAbove: null,
    };
  });
}

/** Loads every rule (in picking order) and category, then resolves which rule each category gets. */
export async function loadCategoryRules(
  preloaded?: Array<{ id: string; parentId: string | null }>,
): Promise<ResolvedCategoryRule[]> {
  const [rules, categories] = await Promise.all([
    TaxRule.findAll({ order: [['createdAt', 'ASC'], ['gstPercentage', 'ASC'], ['id', 'ASC']] }),
    preloaded ?? Category.findAll({ attributes: ['id', 'parentId'] }),
  ]);
  return resolveCategoryRules(rules, categories);
}

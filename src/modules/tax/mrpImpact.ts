import { Op } from 'sequelize';
import { NotFoundError } from '@core/errors/NotFoundError';
import { PRODUCT_STATUS } from '@core/constants/statuses';
import { Category } from '@database/models/category.model';
import { Product } from '@database/models/product.model';
import { ProductVariant } from '@database/models/productVariant.model';
import { TaxRule } from '@database/models/taxRule.model';
import { toPaise } from '@modules/pricing/money';
import { isAboveMrp, type GstRateRule } from './gstPricing';
import { resolveCategoryRules, type ResolvedCategoryRule } from './taxRuleResolution';
import type { TaxRuleImpactRequest } from './tax.dto';

type Rules = Parameters<typeof resolveCategoryRules>[0];
type Tree = Array<{ id: string; parentId: string | null }>;

export type MrpImpact = { productCount: number; variantCount: number; vendorCount: number };

export const toRateRule = (rule: ResolvedCategoryRule): GstRateRule => ({
  gstPercentage: rule.gstPercentage,
  gstPriceBand:
    rule.priceBandThreshold != null && rule.gstPercentageAbove != null
      ? { thresholdPaise: toPaise(rule.priceBandThreshold), gstPercentageAbove: rule.gstPercentageAbove }
      : null,
});

const ruleMap = (rules: Rules, tree: Tree) =>
  new Map(resolveCategoryRules(rules, tree).map((rule) => [rule.categoryId, toRateRule(rule)]));

async function loadCatalog() {
  const [rules, categories] = await Promise.all([
    TaxRule.findAll({ order: [['createdAt', 'ASC'], ['gstPercentage', 'ASC'], ['id', 'ASC']] }),
    Category.findAll({ attributes: ['id', 'parentId'], raw: true }) as unknown as Promise<Tree>,
  ]);
  return { rules: rules as unknown as Rules, categories };
}

/**
 * The options of live and pending listings that a change would put above their MRP: `after`
 * gives the rules and tree as they would be.
 */
export async function newlyAboveMrp(change: {
  after?: (current: { rules: Rules; categories: Tree }) => { rules: Rules; categories: Tree };
}): Promise<MrpImpact> {
  const current = await loadCatalog();
  const next = change.after?.(current) ?? current;
  const [before, after] = [ruleMap(current.rules, current.categories), ruleMap(next.rules, next.categories)];
  // Only categories whose rate would differ need their products looked at.
  const changed = current.categories
    .map((category) => category.id)
    .filter((id) => JSON.stringify(before.get(id)) !== JSON.stringify(after.get(id)));
  if (changed.length === 0) return { productCount: 0, variantCount: 0, vendorCount: 0 };

  const products = (await Product.findAll({
    where: {
      categoryId: { [Op.in]: changed },
      compareAtPrice: { [Op.ne]: null },
      status: { [Op.in]: [PRODUCT_STATUS.LIVE, PRODUCT_STATUS.PENDING_APPROVAL] },
    },
    attributes: ['id', 'vendorId', 'categoryId', 'compareAtPrice'],
    include: [{ model: ProductVariant, as: 'variants', attributes: ['price'] }],
  })) as Array<Product & { variants?: ProductVariant[] }>;

  const impact = { productCount: 0, variantCount: 0 };
  const vendors = new Set<string>();
  for (const product of products) {
    const [was, willBe] = [before.get(product.categoryId)!, after.get(product.categoryId)!];
    const blocked = (product.variants ?? []).filter(
      (variant) =>
        !isAboveMrp(was, variant.price, product.compareAtPrice) && isAboveMrp(willBe, variant.price, product.compareAtPrice),
    ).length;
    if (!blocked) continue;
    impact.productCount += 1;
    impact.variantCount += blocked;
    if (product.vendorId) vendors.add(product.vendorId);
  }
  return { ...impact, vendorCount: vendors.size };
}

/** What creating, editing or deleting a tax rule would take off sale. Changes nothing. */
export async function taxRuleMrpImpact(request: TaxRuleImpactRequest): Promise<MrpImpact> {
  if (request.action !== 'create' && !(await TaxRule.findByPk(request.ruleId, { attributes: ['id'] }))) {
    throw new NotFoundError('TaxRule');
  }
  return newlyAboveMrp({
    after: ({ rules, categories }) => {
      if (request.action === 'delete') return { rules: rules.filter((rule) => rule.id !== request.ruleId), categories };
      const asRule = (fields: Record<string, unknown>) => fields as unknown as Rules[number];
      if (request.action === 'create') {
        const added = asRule({ id: 'proposed', categoryId: null, priceBandThreshold: null, gstPercentageAbove: null, ...request.rule });
        return { rules: [...rules, added], categories };
      }
      return {
        rules: rules.map((rule) => {
          if (rule.id !== request.ruleId) return rule;
          const plain = (rule as unknown as TaxRule).get({ plain: true });
          return asRule({ ...plain, ...request.rule });
        }),
        categories,
      };
    },
  });
}

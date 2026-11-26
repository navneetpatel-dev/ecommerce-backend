import { NotFoundError } from '@core/errors/NotFoundError';
import { taxRepository } from './tax.repository';
import { TaxRule } from '@database/models/taxRule.model';
import { Category } from '@database/models/category.model';
import { loadCategoryRules } from './taxRuleResolution';
import { createTaxRule, deleteTaxRule, listTaxRules, updateTaxRule } from './taxRulesAdmin';

import { toPaise, fromPaise } from '@modules/pricing/money';
import { computeSubOrderBreakdown, type GstPriceBand } from '@modules/pricing/pricing.engine';

export interface TaxCalculation {
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
  gstPercentage: number;
}

/** A tax rule's rate, HSN and optional per-piece price band. */
function effectiveRule(rule: TaxRule): {
  gstPercentage: number;
  hsnCode: string | null;
  gstPriceBand: GstPriceBand | null;
} {
  const threshold = rule.priceBandThreshold != null ? Number(rule.priceBandThreshold) : null;
  const above = rule.gstPercentageAbove != null ? Number(rule.gstPercentageAbove) : null;
  return {
    gstPercentage: Number(rule.gstPercentage),
    hsnCode: rule.hsnCode ? String(rule.hsnCode) : null,
    gstPriceBand:
      threshold != null && above != null && threshold > 0
        ? { thresholdPaise: toPaise(threshold), gstPercentageAbove: above }
        : null,
  };
}

export class TaxService {
  /**
   * Calculate GST tax based on vendor and shipping state.
   * Delegates split math to PricingEngine (paise) so tax matches checkout.
   */
  calculateTax(params: {
    vendorStateCode: string;
    shippingStateCode: string;
    taxableAmount: number;
    gstPercentage: number;
  }): TaxCalculation {
    const intraState =
      String(params.vendorStateCode || '').trim().toUpperCase() ===
      String(params.shippingStateCode || '').trim().toUpperCase();
    const priced = computeSubOrderBreakdown({
      lines: [{ key: 'tax', unitPricePaise: toPaise(params.taxableAmount), quantity: 1 }],
      merchandiseDiscountPaise: 0,
      shippingDiscountPaise: 0,
      shippingCostPaise: 0,
      gstPercentage: params.gstPercentage,
      intraState,
      commissionRatePercent: 0,
      discountBearer: null,
      tcsRatePercent: 0,
    });
    return {
      cgst: fromPaise(priced.tax.cgst),
      sgst: fromPaise(priced.tax.sgst),
      igst: fromPaise(priced.tax.igst),
      total: fromPaise(priced.tax.total),
      gstPercentage: params.gstPercentage,
    };
  }

  /**
   * Resolve the effective tax rule for a category, walking parents when the leaf
   * has no override, falling back to the platform default TaxRule, then to 18%.
   */
  async resolveEffectiveTaxRule(
    categoryId?: string,
  ): Promise<{ gstPercentage: number; hsnCode: string | null; gstPriceBand: GstPriceBand | null }> {
    if (categoryId) {
      const { categoriesService } = await import('../categories/categories.service');
      const chain = await categoriesService.walkCategoryAncestors(categoryId);
      for (const node of chain) {
        const categoryRule = await taxRepository.findByCategory(node.id);
        if (categoryRule) return effectiveRule(categoryRule);
      }
    }

    const defaultRule = await taxRepository.findDefault();
    if (defaultRule) return effectiveRule(defaultRule);

    return { gstPercentage: 18.0, hsnCode: null, gstPriceBand: null };
  }

  /**
   * The HSN code a product is invoiced under: the product's own code when the vendor
   * set one, else the nearest category rule's up the tree (then the default rule) —
   * the same rule the GST rate comes from.
   */
  async resolveHsnCode(product: {
    hsnCode?: string | null;
    categoryId?: string | null;
  }): Promise<string | null> {
    const own = product.hsnCode?.trim();
    if (own) return own;
    const { hsnCode } = await this.resolveEffectiveTaxRule(product.categoryId ?? undefined);
    return hsnCode?.trim() || null;
  }

  /**
   * Get GST rate for a category, walking parents when the leaf has no override.
   */
  async getGstRate(categoryId?: string): Promise<number> {
    const { gstPercentage } = await this.resolveEffectiveTaxRule(categoryId);
    return gstPercentage;
  }

  /** The category's GST % and its per-piece price band, if the rule has one. */
  async getGstRateRule(
    categoryId?: string,
  ): Promise<{ gstPercentage: number; gstPriceBand: GstPriceBand | null }> {
    const { gstPercentage, gstPriceBand } = await this.resolveEffectiveTaxRule(categoryId);
    return { gstPercentage, gstPriceBand };
  }

  /** Which rule every category gets and why (own, inherited, default, fallback). */
  resolveAllCategoryRules(preloaded?: Array<{ id: string; parentId: string | null }>) {
    return loadCategoryRules(preloaded);
  }

  /**
   * The GST every category carries, for pickers: its own rule, else the nearest ancestor's, else the
   * platform default (then 18%), the same walk as `resolveEffectiveTaxRule`, done in memory for all
   * categories at once. A band means the rate changes above a per-piece price.
   */
  async categoryGstRates(preloaded?: Array<{ id: string; parentId: string | null }>) {
    return (await loadCategoryRules(preloaded)).map((row) => ({
      categoryId: row.categoryId,
      gstPercentage: row.gstPercentage,
      priceBandThreshold: row.priceBandThreshold,
      gstPercentageAbove: row.gstPercentageAbove,
    }));
  }

  /** The rule a category gets, with where it comes from ("inherited from Apparel", "default", ...). */
  async explainEffectiveTaxRule(categoryId: string) {
    const category = await Category.findByPk(categoryId, { attributes: ['id', 'name'] });
    if (!category) throw new NotFoundError('Category');
    const [resolved] = (await loadCategoryRules()).filter((row) => row.categoryId === categoryId);
    const from = resolved!.fromCategoryId
      ? await Category.findByPk(resolved!.fromCategoryId, { attributes: ['id', 'name'] })
      : null;
    return { ...resolved!, categoryName: category.name, fromCategoryName: from?.name ?? null };
  }

  // Rule management (the admin Tax page) lives in `taxRulesAdmin.ts`.
  getTaxRules = listTaxRules;
  createTaxRule = createTaxRule;
  updateTaxRule = updateTaxRule;
  deleteTaxRule = deleteTaxRule;
}

export const taxService = new TaxService();

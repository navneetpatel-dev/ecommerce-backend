import { NotFoundError } from '@core/errors/NotFoundError';
import { taxRepository } from './tax.repository';
import { TaxRule } from '@database/models/taxRule.model';
import { Category } from '@database/models/category.model';
import { sequelize } from '@database/models';
import { buildPaginationMeta, paginationOffset } from '@core/http/pagination';

import { toPaise, fromPaise } from '@modules/pricing/money';
import { computeSubOrderBreakdown } from '@modules/pricing/pricing.engine';

export interface TaxCalculation {
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
  gstPercentage: number;
}

function serializeTaxRule(row: TaxRule) {
  const plain: any = typeof (row as any).get === 'function' ? (row as any).get({ plain: true }) : row;
  return {
    id: plain.id,
    hsnCode: plain.hsnCode,
    gstPercentage: Number(plain.gstPercentage),
    categoryName: plain.category?.name ?? null,
    createdAt: plain.createdAt,
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
   * Get GST rate for a category, walking parents when the leaf has no override.
   */
  async getGstRate(categoryId?: string): Promise<number> {
    if (categoryId) {
      const { categoriesService } = await import('../categories/categories.service');
      const chain = await categoriesService.walkCategoryAncestors(categoryId);
      for (const node of chain) {
        const categoryRule = await taxRepository.findByCategory(node.id);
        if (categoryRule) {
          return Number(categoryRule.gstPercentage);
        }
      }
    }

    const defaultRule = await taxRepository.findDefault();
    if (defaultRule) {
      return Number(defaultRule.gstPercentage);
    }

    return 18.0;
  }

  async getTaxRules(query: { page: number; limit: number }) {
    const offset = paginationOffset(query.page, query.limit);
    const { rows, count } = await TaxRule.findAndCountAll({
      include: [{ model: Category, as: 'category', attributes: ['id', 'name'], required: false }],
      order: [['createdAt', 'DESC']],
      limit: query.limit,
      offset,
      distinct: true,
      col: 'id',
    });
    return {
      rules: rows.map((row) => serializeTaxRule(row)),
      pagination: buildPaginationMeta(count, query.page, query.limit),
    };
  }

  async createTaxRule(data: {
    categoryId?: string;
    hsnCode?: string;
    gstPercentage: number;
  }) {
    return sequelize.transaction(async (t) => {
      const rule = await TaxRule.create({
        categoryId: data.categoryId ?? null,
        hsnCode: data.hsnCode ?? null,
        gstPercentage: data.gstPercentage,
      }, { transaction: t });

      return rule;
    });
  }

  async updateTaxRule(id: string, data: {
    categoryId?: string;
    hsnCode?: string;
    gstPercentage?: number;
  }) {
    return sequelize.transaction(async (t) => {
      const rule = await TaxRule.findByPk(id, { transaction: t });
      if (!rule) throw new NotFoundError('TaxRule');

      await rule.update(data, { transaction: t });
      return rule;
    });
  }

  async deleteTaxRule(id: string) {
    return sequelize.transaction(async (t) => {
      const rule = await TaxRule.findByPk(id, { transaction: t });
      if (!rule) throw new NotFoundError('TaxRule');

      await rule.destroy({ transaction: t });
    });
  }
}

export const taxService = new TaxService();

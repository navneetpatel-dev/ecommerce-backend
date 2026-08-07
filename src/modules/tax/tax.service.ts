import { NotFoundError } from '@core/errors/NotFoundError';
import { taxRepository } from './tax.repository';
import { TaxRule } from '@database/models/taxRule.model';
import { Category } from '@database/models/category.model';
import { sequelize } from '@database/models';
import { buildPaginationMeta, paginationOffset } from '@core/http/pagination';

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
   * Calculate GST tax based on vendor and shipping state
   * CGST+SGST for intra-state, IGST for inter-state
   */
  calculateTax(params: {
    vendorStateCode: string;
    shippingStateCode: string;
    taxableAmount: number;
    gstPercentage: number;
  }): TaxCalculation {
    const total = this.round2(params.taxableAmount * (params.gstPercentage / 100));
    
    if (params.vendorStateCode === params.shippingStateCode) {
      // Intra-state: CGST + SGST
      return {
        cgst: this.round2(total / 2),
        sgst: this.round2(total / 2),
        igst: 0,
        total,
        gstPercentage: params.gstPercentage,
      };
    }
    
    // Inter-state: IGST
    return {
      cgst: 0,
      sgst: 0,
      igst: total,
      total,
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

  private round2(num: number): number {
    return Math.round(num * 100) / 100;
  }
}

export const taxService = new TaxService();

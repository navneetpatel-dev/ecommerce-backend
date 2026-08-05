import { NotFoundError } from '@core/errors/NotFoundError';
import { taxRepository } from './tax.repository';
import { TaxRule } from '@database/models/taxRule.model';
import { sequelize } from '@database/models';

export interface TaxCalculation {
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
  gstPercentage: number;
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
   * Get GST rate for a category, falling back to platform default
   */
  async getGstRate(categoryId?: string): Promise<number> {
    if (categoryId) {
      const categoryRule = await taxRepository.findByCategory(categoryId);
      if (categoryRule) {
        return Number(categoryRule.gstPercentage);
      }
    }
    
    const defaultRule = await taxRepository.findDefault();
    if (defaultRule) {
      return Number(defaultRule.gstPercentage);
    }
    
    // Default GST rate if no rules exist
    return 18.0;
  }

  async getTaxRules() {
    return TaxRule.findAll({ order: [['createdAt', 'DESC']] });
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

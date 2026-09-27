import { BaseRepository } from '@core/repository/BaseRepository';
import { TaxRule } from '@database/models/taxRule.model';

const RULE_ORDER: Array<[string, 'ASC' | 'DESC']> = [
  ['createdAt', 'ASC'],
  ['gstPercentage', 'ASC'],
  ['id', 'ASC'],
];

export class TaxRepository extends BaseRepository<TaxRule> {
  constructor() {
    super(TaxRule);
  }

  /**
   * Rule lookups pick one row deterministically (oldest, then lowest rate): with more
   * than one candidate an unordered lookup let the database choose the GST rate.
   */
  async findByCategory(categoryId: string) {
    return this.model.findOne({ where: { categoryId }, order: RULE_ORDER });
  }

  async findDefault() {
    return this.model.findOne({ where: { categoryId: null }, order: RULE_ORDER });
  }

  async countDefaults(): Promise<number> {
    return this.model.count({ where: { categoryId: null } });
  }
}

export const taxRepository = new TaxRepository();

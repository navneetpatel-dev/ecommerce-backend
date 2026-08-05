import { BaseRepository } from '@core/repository/BaseRepository';
import { TaxRule } from '@database/models/taxRule.model';

export class TaxRepository extends BaseRepository<TaxRule> {
  constructor() {
    super(TaxRule);
  }

  async findByCategory(categoryId: string) {
    return this.model.findOne({ where: { categoryId } });
  }

  async findDefault() {
    return this.model.findOne({ where: { categoryId: null } });
  }
}

export const taxRepository = new TaxRepository();

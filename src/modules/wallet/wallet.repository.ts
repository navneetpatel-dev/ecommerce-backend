import { BaseRepository } from '@core/repository/BaseRepository';
import { WalletLedger } from '@database/models/walletLedger.model';

export class WalletRepository extends BaseRepository<WalletLedger> {
  constructor() {
    super(WalletLedger);
  }

  async getLatestEntry(userId: string) {
    return this.model.findOne({
      where: { userId },
      order: [['createdAt', 'DESC']],
    });
  }

  async getUserTransactions(userId: string, limit: number, offset: number) {
    return this.model.findAndCountAll({
      where: { userId },
      order: [['createdAt', 'DESC']],
      limit,
      offset,
    });
  }
}

export const walletRepository = new WalletRepository();

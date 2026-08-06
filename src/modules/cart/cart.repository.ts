import type { Transaction } from 'sequelize';
import { BaseRepository } from '@core/repository/BaseRepository';
import { Cart } from '@database/models/cart.model';

export class CartRepository extends BaseRepository<Cart> {
  constructor() {
    super(Cart);
  }

  async findByUserId(userId: string) {
    return this.model.findOne({
      where: { userId },
      include: ['items'],
    });
  }

  async findBySessionId(sessionId: string) {
    return this.model.findOne({
      where: { sessionId },
      include: ['items'],
    });
  }

  async findOrCreateByUser(userId: string, transaction?: Transaction) {
    const [cart] = await this.model.findOrCreate({
      where: { userId },
      defaults: { userId },
      transaction,
    });
    return cart;
  }

  async findOrCreateBySession(sessionId: string, transaction?: Transaction) {
    const [cart] = await this.model.findOrCreate({
      where: { sessionId },
      defaults: { sessionId },
      transaction,
    });
    return cart;
  }
}

export const cartRepository = new CartRepository();

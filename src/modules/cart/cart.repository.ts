import { BaseRepository } from '@core/repository/BaseRepository';
import { Cart } from '@database/models/cart.model';
import { CartItem } from '@database/models/cartItem.model';

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

  async findOrCreateByUser(userId: string) {
    const [cart] = await this.model.findOrCreate({
      where: { userId },
      defaults: { userId },
    });
    return cart;
  }

  async findOrCreateBySession(sessionId: string) {
    const [cart] = await this.model.findOrCreate({
      where: { sessionId },
      defaults: { sessionId },
    });
    return cart;
  }
}

export const cartRepository = new CartRepository();

import type { Transaction } from 'sequelize';
import { BaseRepository } from '@core/repository/BaseRepository';
import { Cart } from '@database/models/cart.model';

export class CartRepository extends BaseRepository<Cart> {
  constructor() {
    super(Cart);
  }

  async findByUserId(userId: string, transaction?: Transaction) {
    return this.model.findOne({
      where: { userId },
      include: ['items'],
      transaction,
    });
  }

  async findBySessionId(sessionId: string, transaction?: Transaction) {
    return this.model.findOne({
      where: { sessionId },
      include: ['items'],
      transaction,
    });
  }

  /**
   * `lock` also row-locks the cart (SELECT ... FOR UPDATE) for the rest of the transaction,
   * so writes to one cart run one at a time: two adds of the same variant would otherwise
   * each find no line and each insert one, and checkout would see the variant twice.
   */
  async findOrCreateByUser(userId: string, transaction?: Transaction, opts?: { lock?: boolean }) {
    const [cart] = await this.model.findOrCreate({
      where: { userId },
      defaults: { userId },
      transaction,
    });
    if (opts?.lock && transaction) await this.lockById(cart.id, transaction);
    return cart;
  }

  /**
   * Row-locks the user's cart (SELECT ... FOR UPDATE) so cart writes and checkout on the
   * same cart run one at a time. A missing cart locks nothing.
   */
  async lockByUser(userId: string, transaction: Transaction) {
    return this.model.findOne({
      where: { userId },
      attributes: ['id'],
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
  }

  /** Row-locks a cart by id; see `lockByUser`. */
  async lockById(cartId: string, transaction: Transaction) {
    return this.model.findByPk(cartId, {
      attributes: ['id'],
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
  }

  /** See `findOrCreateByUser` for `lock`. */
  async findOrCreateBySession(sessionId: string, transaction?: Transaction, opts?: { lock?: boolean }) {
    const [cart] = await this.model.findOrCreate({
      where: { sessionId },
      defaults: { sessionId },
      transaction,
    });
    if (opts?.lock && transaction) await this.lockById(cart.id, transaction);
    return cart;
  }
}

export const cartRepository = new CartRepository();

import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { sequelize } from '@database/models';
import { WishlistItem } from '@database/models/wishlistItem.model';
import { Cart } from '@database/models/cart.model';
import { CartItem } from '@database/models/cartItem.model';
import { wishlistRepository } from '../wishlist.repository';
import { wishlistService } from '../wishlist.service';
import { ValidationError } from '@core/errors/ValidationError';

describe('WishlistService.moveToCart stock clamp', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  function stubMove(opts: { stock: number; cartQuantity: number }) {
    mock.method(sequelize, 'transaction', async (callback: (t: unknown) => Promise<unknown>) => {
      return callback({});
    });
    mock.method(wishlistRepository, 'findByUserId', async () => ({ id: 'wl-1' }));
    mock.method(WishlistItem, 'findOne', async () => ({
      id: 'wi-1',
      product: {
        variants: [{ id: 'var-1', stock: opts.stock, createdAt: new Date() }],
      },
      destroy: async () => undefined,
    }) as unknown as WishlistItem);
    mock.method(Cart, 'findOrCreate', async () => [{ id: 'cart-1' }]);

    const cartItem = {
      quantity: opts.cartQuantity,
      update: async (fields: { quantity: number }) => {
        cartItem.quantity = fields.quantity;
      },
    };
    mock.method(CartItem, 'findOne', async () => cartItem as unknown as CartItem);
    return cartItem;
  }

  it('does not increment past variant.stock and signals insufficient stock', async () => {
    stubMove({ stock: 2, cartQuantity: 2 });
    await assert.rejects(
      () => wishlistService.moveToCart('user-1', 'prod-1'),
      (err: unknown) => err instanceof ValidationError,
    );
  });

  it('increments to exactly variant.stock and not beyond', async () => {
    const cartItem = stubMove({ stock: 3, cartQuantity: 2 });
    await wishlistService.moveToCart('user-1', 'prod-1');
    assert.equal(cartItem.quantity, 3);
  });
});

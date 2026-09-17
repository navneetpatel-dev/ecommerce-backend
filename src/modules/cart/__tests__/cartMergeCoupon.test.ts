import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { sequelize } from '@database/models';
import { Cart } from '@database/models/cart.model';
import { CartItem } from '@database/models/cartItem.model';
import { ProductVariant } from '@database/models/productVariant.model';
import { cartRepository } from '../cart.repository';
import { cartService } from '../cart.service';
import { couponsService } from '@modules/coupons/coupons.service';

describe('CartService.mergeGuestCartIntoUserCart coupon copy', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  function stubMergeBase(guestCart: Record<string, unknown>, userCart: Record<string, unknown>) {
    mock.method(sequelize, 'transaction', async (callback: (t: unknown) => Promise<unknown>) => {
      return callback({ LOCK: { UPDATE: 'UPDATE' } });
    });
    mock.method(Cart, 'findOne', async () => guestCart as unknown as Cart);
    mock.method(cartRepository, 'findOrCreateByUser', async () => userCart as never);
    let findAllCalls = 0;
    mock.method(CartItem, 'findAll', async () => {
      findAllCalls += 1;
      if (findAllCalls === 1) return [{ variantId: 'var-1', quantity: 1 }];
      return [];
    });
    mock.method(ProductVariant, 'findAll', async () => [{ id: 'var-1', stock: 10 }]);
    mock.method(CartItem, 'create', async (fields: Record<string, unknown>) => fields);
    mock.method(CartItem, 'destroy', async () => 1);
  }

  it('copies guest coupon onto a user cart that has none', async () => {
    const guestCart = {
      id: 'guest-cart',
      userId: null,
      couponCode: 'SAVE10',
      couponCodes: ['SAVE10'],
      destroy: async () => undefined,
    };
    const userCart = {
      id: 'user-cart',
      couponCode: null,
      couponCodes: [],
      update: async (fields: Record<string, unknown>) => {
        Object.assign(userCart, fields);
      },
    };
    stubMergeBase(guestCart, userCart);

    await cartService.mergeGuestCartIntoUserCart('sess-1', 'user-1');
    assert.equal(userCart.couponCode, 'SAVE10');
    assert.deepEqual(userCart.couponCodes, ['SAVE10']);
  });

  it('does not overwrite an existing user-cart coupon', async () => {
    const userCart = {
      id: 'user-cart',
      couponCode: 'MINE',
      couponCodes: ['MINE'],
      update: async () => {
        throw new Error('user cart coupon must not be overwritten');
      },
    };
    stubMergeBase(
      {
        id: 'guest-cart',
        userId: null,
        couponCode: 'SAVE10',
        couponCodes: ['SAVE10'],
        destroy: async () => undefined,
      },
      userCart,
    );

    await cartService.mergeGuestCartIntoUserCart('sess-1', 'user-1');
    assert.equal(userCart.couponCode, 'MINE');
  });

  it('getCart revalidation clears a copied coupon that is no longer valid', async () => {
    mock.method(cartRepository, 'findByUserId', async () => ({
      id: 'user-cart',
      couponCode: 'SAVE10',
      couponCodes: ['SAVE10'],
    }));
    mock.method(CartItem, 'findAll', async () => []);
    mock.method(couponsService, 'revalidateCartCoupon', async () => ({
      removed: true,
      reason: 'expired',
      reasonCode: 'EXPIRED',
      appliedCoupon: null,
      appliedCoupons: [],
    }));

    const view = await cartService.getCart('user-1', null);
    assert.equal(view.appliedCoupon, null);
    assert.equal(view.removedCouponReason, 'expired');
  });
});

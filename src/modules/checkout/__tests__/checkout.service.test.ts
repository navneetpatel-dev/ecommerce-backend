import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { sequelize } from '@database/models';
import { Order } from '@database/models/order.model';
import { ProductVariant } from '@database/models/productVariant.model';
import { CommissionLedger } from '@database/models/commissionLedger.model';
import { TcsLedger } from '@database/models/tcsLedger.model';
import { Coupon } from '@database/models/coupon.model';
import { CouponUsage } from '@database/models/couponUsage.model';
import { cartService } from '@modules/cart/cart.service';
import { notificationsService } from '@modules/notifications/notifications.service';
import { checkoutService } from '../checkout.service';
import { ORDER_STATUS, PAYMENT_STATUS } from '@core/constants/statuses';
import { Cart } from '@database/models/cart.model';

const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const COUPON_ID = '33333333-3333-4333-8333-333333333333';

describe('CheckoutService.cancelPendingCheckout coupon rollback', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it('destroys CouponUsage and decrements Coupon.usedCount', async () => {
    mock.method(sequelize, 'transaction', async (callback: (t: unknown) => Promise<unknown>) => {
      return callback({ LOCK: { UPDATE: 'UPDATE' } });
    });

    const mockOrder = {
      id: ORDER_ID,
      userId: USER_ID,
      paymentStatus: PAYMENT_STATUS.PENDING,
      status: ORDER_STATUS.CONFIRMED,
      walletAmountUsed: 0,
      subOrders: [
        {
          id: 'sub-1',
          status: ORDER_STATUS.CONFIRMED,
          items: [{ variantId: 'var-1', quantity: 1 }],
          update: async () => undefined,
        },
      ],
      update: async () => undefined,
    };

    mock.method(Order, 'findByPk', async () => mockOrder as unknown as Order);
    mock.method(ProductVariant, 'increment', async () => undefined);
    mock.method(CommissionLedger, 'destroy', async () => 1);
    mock.method(TcsLedger, 'destroy', async () => 1);
    mock.method(cartService, 'restoreItemsToUserCart', async () => undefined);
    mock.method(notificationsService, 'sendOrderCancelled', () => undefined);

    const usages: Array<{ couponId: string; orderId: string; destroy: () => Promise<void> }> = [
      {
        couponId: COUPON_ID,
        orderId: ORDER_ID,
        destroy: async () => {
          usages.splice(0, 1);
        },
      },
    ];
    let usedCount = 1;
    mock.method(CouponUsage, 'findAll', async () => [...usages]);
    mock.method(CouponUsage, 'findOne', async () => usages[0] ?? null);
    mock.method(Coupon, 'decrement', async () => {
      usedCount -= 1;
      return [1] as never;
    });

    await checkoutService.cancelPendingCheckout(USER_ID, { orderId: ORDER_ID });

    const remaining = await CouponUsage.findOne({ where: { orderId: ORDER_ID } });
    assert.equal(remaining, null);
    assert.equal(usedCount, 0);
  });
});

describe('CheckoutService.createOrderFromCart stock lock', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it('checks stock against the variant total when a cart holds two lines of it', async () => {
    mock.method(sequelize, 'transaction', async (callback: (t: unknown) => Promise<unknown>) =>
      callback({ LOCK: { UPDATE: 'UPDATE' } }),
    );
    const variant = {
      id: 'var-1',
      stock: 3,
      product: { name: 'Mug', status: 'LIVE', vendor: { status: 'APPROVED', kycVerified: true } },
    };
    const cart = {
      id: 'cart-1',
      items: [
        { id: 'line-1', variantId: 'var-1', quantity: 2, variant },
        { id: 'line-2', variantId: 'var-1', quantity: 2, variant },
      ],
    };
    mock.method(Cart, 'findOne', async () => cart);
    mock.method(ProductVariant, 'findAll', async () => [{ id: 'var-1', stock: 3 }]);
    const decrement = mock.fn(async () => undefined);
    (variant as unknown as { decrement: unknown }).decrement = decrement;

    await assert.rejects(
      checkoutService.createOrderFromCart(USER_ID, {
        shippingAddressId: '44444444-4444-4444-8444-444444444444',
        paymentMethod: 'COD',
      } as never),
      (err: { statusCode?: number; details?: { items?: unknown[] } }) =>
        err.statusCode === 422 && err.details?.items?.length === 2,
    );
    assert.equal(decrement.mock.callCount(), 0);
  });
});

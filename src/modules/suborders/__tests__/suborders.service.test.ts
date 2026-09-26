import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { SubOrder } from '@database/models/subOrder.model';
import { Order } from '@database/models/order.model';
import { ProductVariant } from '@database/models/productVariant.model';
import { CommissionLedger } from '@database/models/commissionLedger.model';
import { TcsLedger } from '@database/models/tcsLedger.model';
import { WalletLedger } from '@database/models/walletLedger.model';
import { sequelize } from '@database/models';
import { subordersService } from '@modules/suborders/suborders.service';
import { walletService } from '@modules/wallet/wallet.service';
import { paymentsService } from '@modules/payments/payments.service';
import { notificationsService } from '@modules/notifications/notifications.service';
import {
  ORDER_STATUS,
  PAYMENT_METHOD,
  PAYMENT_STATUS,
} from '@core/constants/statuses';
import { toPaise } from '@modules/pricing/money';

const SUB_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const SUB_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const ORDER_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

describe('SubordersService cancellation refund split', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  function stubCancellationBase(mockSubOrder: {
    id: string;
    orderId: string;
    status: string;
    subtotal: number;
    customerTotal: number;
    update: (fields: unknown) => Promise<void>;
    reload: () => Promise<unknown>;
  }) {
    mock.method(sequelize, 'transaction', async (callback: (t: unknown) => Promise<unknown>) => {
      return callback({ LOCK: { UPDATE: 'UPDATE' } });
    });

    mock.method(SubOrder, 'findByPk', async (_id: string, options?: { include?: unknown }) => {
      if (options?.include) {
        return {
          ...mockSubOrder,
          items: [{ variantId: 'var-1', quantity: 1 }],
          order: { id: ORDER_ID, userId: 'user-123' },
        } as unknown as SubOrder;
      }
      return mockSubOrder as unknown as SubOrder;
    });

    mock.method(ProductVariant, 'increment', async () => undefined);
    mock.method(CommissionLedger, 'destroy', async () => 1);
    mock.method(TcsLedger, 'destroy', async () => 1);
    mock.method(notificationsService, 'sendOrderCancelled', () => undefined);
  }

  it('full cancel of mixed-payment last suborder credits wallet once for the wallet share and refunds Razorpay for the rest', async () => {
    const mockSubOrder = {
      id: SUB_A,
      orderId: ORDER_ID,
      status: ORDER_STATUS.CONFIRMED,
      subtotal: 1000,
      customerTotal: 1000,
      update: async () => undefined,
      reload: async () => mockSubOrder,
    };
    stubCancellationBase(mockSubOrder);

    const creditAmounts: number[] = [];
    mock.method(walletService, 'credit', async (_userId: string, amount: number) => {
      creditAmounts.push(amount);
      return {} as never;
    });

    mock.method(WalletLedger, 'findOne', async () => null);
    // No earlier part of this order was cancelled, so no wallet share was returned yet.
    mock.method(WalletLedger, 'findAll', async () => []);

    mock.method(Order, 'findByPk', async () => ({
      id: ORDER_ID,
      userId: 'user-123',
      paymentStatus: PAYMENT_STATUS.PAID,
      paymentMethod: PAYMENT_METHOD.RAZORPAY,
      status: ORDER_STATUS.CONFIRMED,
      totalAmount: 1000,
      originalTotalAmount: 1000,
      walletAmountUsed: 300,
      razorpayAmountPaid: 700,
      razorpayPaymentId: 'pay_mixed_1',
    }) as unknown as Order);

    mock.method(SubOrder, 'findAll', async () => [
      { id: SUB_A, status: ORDER_STATUS.CANCELLED, customerTotal: 1000, subtotal: 1000 },
    ] as unknown as SubOrder[]);

    mock.method(Order, 'update', async () => [1]);

    const razorpayAmounts: number[] = [];
    mock.method(paymentsService, 'createRazorpayRefund', async (_paymentId: string, amountPaise: number) => {
      razorpayAmounts.push(amountPaise);
      return 'rfnd_mixed_1';
    });

    await subordersService.updateStatus(SUB_A, ORDER_STATUS.CANCELLED, undefined, 'actor-1');

    const walletSum = creditAmounts.reduce((s, n) => s + n, 0);
    assert.equal(creditAmounts.length >= 1, true);
    assert.equal(walletSum, 300);
    assert.equal(
      creditAmounts.some((n) => n === 1000 || n === 1300),
      false,
    );
    assert.equal(razorpayAmounts.length, 1);
    assert.equal(razorpayAmounts[0], toPaise(700));
  });

  it('partial cancel of a cash-only order refunds only that suborder and does not roll back order wallet', async () => {
    const mockSubOrder = {
      id: SUB_A,
      orderId: ORDER_ID,
      status: ORDER_STATUS.CONFIRMED,
      subtotal: 500,
      customerTotal: 500,
      update: async () => undefined,
      reload: async () => mockSubOrder,
    };
    stubCancellationBase(mockSubOrder);

    const creditAmounts: number[] = [];
    mock.method(walletService, 'credit', async (_userId: string, amount: number) => {
      creditAmounts.push(amount);
      return {} as never;
    });

    let walletLedgerLookups = 0;
    mock.method(WalletLedger, 'findOne', async () => {
      walletLedgerLookups += 1;
      return null;
    });

    mock.method(Order, 'findByPk', async () => ({
      id: ORDER_ID,
      userId: 'user-123',
      paymentStatus: PAYMENT_STATUS.PAID,
      paymentMethod: PAYMENT_METHOD.RAZORPAY,
      status: ORDER_STATUS.CONFIRMED,
      totalAmount: 1000,
      originalTotalAmount: 1000,
      walletAmountUsed: 0,
      razorpayAmountPaid: 1000,
      razorpayPaymentId: 'pay_cash_1',
    }) as unknown as Order);

    mock.method(SubOrder, 'findAll', async () => [
      { id: SUB_A, status: ORDER_STATUS.CANCELLED, customerTotal: 500, subtotal: 500 },
      { id: SUB_B, status: ORDER_STATUS.CONFIRMED, customerTotal: 500, subtotal: 500 },
    ] as unknown as SubOrder[]);

    let parentOrderUpdated = false;
    mock.method(Order, 'update', async () => {
      parentOrderUpdated = true;
      return [1];
    });

    const razorpayAmounts: number[] = [];
    mock.method(paymentsService, 'createRazorpayRefund', async (_paymentId: string, amountPaise: number) => {
      razorpayAmounts.push(amountPaise);
      return 'rfnd_partial_1';
    });

    await subordersService.updateStatus(SUB_A, ORDER_STATUS.CANCELLED, undefined, 'actor-1');

    const walletSum = creditAmounts.reduce((s, n) => s + n, 0);
    assert.equal(walletSum, 0);
    assert.equal(creditAmounts.length, 0);
    assert.equal(walletLedgerLookups, 0);
    assert.equal(parentOrderUpdated, false);
    assert.equal(razorpayAmounts.length, 1);
    assert.equal(razorpayAmounts[0], toPaise(500));
  });
});

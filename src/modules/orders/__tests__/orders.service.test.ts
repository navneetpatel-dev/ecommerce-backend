import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { Product } from '@database/models/product.model';
import { ReturnRequest } from '@database/models/returnRequest.model';
import { Order } from '@database/models/order.model';
import { sequelize } from '@database/models';
import { ordersRepository } from '../orders.repository';
import { ordersService } from '../orders.service';

type IncludeEntry = {
  model?: unknown;
  include?: IncludeEntry[];
  paranoid?: boolean;
};

function findProductInclude(include: unknown): IncludeEntry | undefined {
  if (!Array.isArray(include)) return undefined;
  for (const entry of include as IncludeEntry[]) {
    if (entry?.model === Product) return entry;
    const nested = findProductInclude(entry?.include);
    if (nested) return nested;
  }
  return undefined;
}

describe('OrdersService.getOrderById image join', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it('unscopes Product so soft-deleted catalogue rows still join live images', async () => {
    let capturedInclude: unknown;
    mock.method(ordersRepository, 'findById', async (_id: string, opts?: { include?: unknown }) => {
      capturedInclude = opts?.include;
      return {
        id: 'order-1',
        userId: 'user-1',
        totalAmount: 100,
        walletAmountUsed: 0,
        discountTotal: 0,
        status: 'CONFIRMED',
        paymentStatus: 'PAID',
        subOrders: [
          {
            id: 'sub-1',
            orderId: 'order-1',
            vendorId: 'vendor-1',
            subtotal: 100,
            shippingCost: 0,
            shippingDiscountAmount: 0,
            taxableAmount: 100,
            taxAmount: 0,
            discountAmount: 0,
            items: [
              {
                id: 'item-1',
                variantId: 'var-1',
                productName: 'Archived shirt',
                quantity: 1,
                unitPrice: 100,
                taxableAmount: 100,
                taxAmount: 0,
                discountAmount: 0,
                commissionAmount: 0,
                tcsAmount: 0,
                netPayoutAmount: 0,
                lineSubtotal: 100,
                variant: {
                  attributes: { Size: 'M' },
                  product: {
                    slug: 'archived-shirt',
                    deletedAt: new Date('2026-01-01'),
                    images: [{ url: 'https://cdn.example/archived.jpg', isPrimary: true }],
                  },
                },
              },
            ],
          },
        ],
      };
    });
    mock.method(ReturnRequest, 'findAll', async () => []);

    const order = await ordersService.getOrderById('order-1', 'user-1');
    const productInclude = findProductInclude(capturedInclude);
    assert.ok(productInclude);
    assert.equal(productInclude.paranoid, false);
    assert.equal(order.subOrders[0]?.items[0]?.imageUrl, 'https://cdn.example/archived.jpg');
  });
});

type AttributeInclude = {
  as?: string;
  association?: string;
  attributes?: string[];
  include?: unknown[];
};

/** Every include entry for `alias` (by `as` or `association`), however deep. */
function findIncludes(include: unknown, alias: string): AttributeInclude[] {
  if (!Array.isArray(include)) return [];
  return (include as AttributeInclude[]).flatMap((entry) => [
    ...(entry?.as === alias || entry?.association === alias ? [entry] : []),
    ...findIncludes(entry?.include, alias),
  ]);
}

function assertNoPrivateFields(include: unknown) {
  for (const alias of ['vendor', 'deliveryAgent']) {
    for (const entry of findIncludes(include, alias)) {
      assert.ok(Array.isArray(entry.attributes), `${alias} include must list its attributes`);
      assert.equal(entry.attributes!.includes('bankDetails'), false);
      assert.equal(entry.attributes!.includes('lastLat'), false);
      assert.equal(entry.attributes!.includes('gstNumber'), false);
    }
  }
}

describe('Order payloads never carry vendor or agent bank details', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it('limits vendor and delivery agent columns on the order detail', async () => {
    let capturedInclude: unknown;
    mock.method(ordersRepository, 'findById', async (_id: string, opts?: { include?: unknown }) => {
      capturedInclude = opts?.include;
      return null;
    });
    await ordersService.getOrderById('order-1', 'user-1').catch(() => undefined);
    assert.equal(findIncludes(capturedInclude, 'vendor').length, 1);
    assert.equal(findIncludes(capturedInclude, 'deliveryAgent').length, 1);
    assertNoPrivateFields(capturedInclude);
  });

  it('limits vendor columns on the order list', async () => {
    let capturedInclude: unknown;
    mock.method(Order, 'findAndCountAll', async (opts?: { include?: unknown }) => {
      capturedInclude = opts?.include;
      return { rows: [], count: 0 } as never;
    });
    await ordersRepository.findWithFilters({ userId: 'user-1', limit: 10, offset: 0 });
    assert.equal(findIncludes(capturedInclude, 'vendor').length, 1);
    assertNoPrivateFields(capturedInclude);
  });
});

describe('OrdersService.updateOrderStatus (admin)', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  function stubOrder(fields: Record<string, unknown>) {
    mock.method(sequelize, 'transaction', async (callback: (t: unknown) => Promise<unknown>) =>
      callback({ LOCK: { UPDATE: 'UPDATE' } }),
    );
    mock.method(ordersRepository, 'findById', async () => ({ id: 'order-1', ...fields }) as never);
    return mock.method(ordersRepository, 'update', async () => [1] as never);
  }

  it('never ships an order by hand: it follows its parts', async () => {
    const update = stubOrder({ status: 'CONFIRMED', paymentMethod: 'COD', paymentStatus: 'PENDING' });
    await assert.rejects(ordersService.updateOrderStatus('order-1', 'SHIPPED', 'admin-1'), /Cannot move/);
    assert.equal(update.mock.callCount(), 0);
  });

  it('never confirms an online order still awaiting payment', async () => {
    const update = stubOrder({ status: 'PENDING', paymentMethod: 'RAZORPAY', paymentStatus: 'PENDING' });
    await assert.rejects(ordersService.updateOrderStatus('order-1', 'CONFIRMED', 'admin-1'), /awaiting payment/);
    assert.equal(update.mock.callCount(), 0);
  });
});

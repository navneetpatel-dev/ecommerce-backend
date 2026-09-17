import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { Product } from '@database/models/product.model';
import { ReturnRequest } from '@database/models/returnRequest.model';
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

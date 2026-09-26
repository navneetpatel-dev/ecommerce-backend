import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import type { Transaction } from 'sequelize';
import { Order } from '@database/models/order.model';
import { SubOrder } from '@database/models/subOrder.model';
import { Vendor } from '@database/models/vendor.model';
import { VendorInvoiceSequence } from '@database/models/vendorInvoiceSequence.model';
import { ORDER_STATUS } from '@core/constants/statuses';
import { issueTaxInvoicesOnDispatch } from '../taxInvoiceIssue';

const transaction = { LOCK: { UPDATE: 'UPDATE', SHARE: 'SHARE' } } as unknown as Transaction;

function row<T extends Record<string, unknown>>(fields: T) {
  const updates: Array<Record<string, unknown>> = [];
  return {
    ...fields,
    updates,
    async update(values: Record<string, unknown>) {
      updates.push(values);
      Object.assign(this, values);
      return this;
    },
  };
}

function mockSequence() {
  let next = 1;
  mock.method(Vendor, 'findByPk', async () => ({ id: 'vendor-1', slug: 'inkwell', invoicePrefix: 'INK' }) as never);
  mock.method(VendorInvoiceSequence, 'findOne', async () => ({
    get nextValue() {
      return next;
    },
    update: async () => {
      next += 1;
    },
  }));
}

const giftWrapSnapshot = {
  invoiceNumber: null,
  issuedAt: null,
  intraState: true,
  totalPaise: 4900,
  lines: [],
};

describe('issueTaxInvoicesOnDispatch', () => {
  afterEach(() => mock.restoreAll());

  it('numbers the vendor invoice and the platform gift-wrap invoice at dispatch', async () => {
    mockSequence();
    const sub = row({
      id: 'so-1',
      orderId: 'order-1',
      vendorId: 'vendor-1',
      status: ORDER_STATUS.SHIPPED,
      taxInvoiceNumber: null as string | null,
    });
    const order = row({ id: 'order-1', platformInvoiceSnapshot: { ...giftWrapSnapshot } });
    mock.method(SubOrder, 'findByPk', async () => sub as never);
    mock.method(Order, 'findByPk', async () => order as never);

    await issueTaxInvoicesOnDispatch('so-1', transaction);

    assert.match(String(sub.taxInvoiceNumber), /^INK\//);
    const snapshot = order.platformInvoiceSnapshot as unknown as { invoiceNumber: string; issuedAt: string };
    assert.match(snapshot.invoiceNumber, /^PLAT\//);
    assert.ok(snapshot.issuedAt);

    // Delivery after shipping keeps the numbers already issued.
    await issueTaxInvoicesOnDispatch('so-1', transaction);
    assert.equal(sub.updates.length, 1);
    assert.equal(order.updates.length, 1);
  });

  it('issues nothing for a cancelled sub-order', async () => {
    mockSequence();
    const sub = row({
      id: 'so-2',
      orderId: 'order-2',
      vendorId: 'vendor-1',
      status: ORDER_STATUS.CANCELLED,
      taxInvoiceNumber: null as string | null,
    });
    const order = row({ id: 'order-2', platformInvoiceSnapshot: { ...giftWrapSnapshot } });
    mock.method(SubOrder, 'findByPk', async () => sub as never);
    const findOrder = mock.method(Order, 'findByPk', async () => order as never);

    await issueTaxInvoicesOnDispatch('so-2', transaction);

    assert.equal(sub.taxInvoiceNumber, null);
    assert.equal(findOrder.mock.callCount(), 0);
  });
});

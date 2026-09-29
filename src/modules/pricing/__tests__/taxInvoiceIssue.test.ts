import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import type { Transaction } from 'sequelize';
import { Order } from '@database/models/order.model';
import { SubOrder } from '@database/models/subOrder.model';
import { Vendor } from '@database/models/vendor.model';
import { VendorInvoiceSequence } from '@database/models/vendorInvoiceSequence.model';
import { TcsLedger } from '@database/models/tcsLedger.model';
import { CommissionLedger } from '@database/models/commissionLedger.model';
import { OrderItem } from '@database/models/orderItem.model';
import { ORDER_STATUS } from '@core/constants/statuses';
import { settingsService } from '@modules/settings/settings.service';
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
      tcsAmountPaise: 0,
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

  it("numbers the part's shipping invoice and records its TCS at dispatch", async () => {
    mockSequence();
    const sub = row({
      id: 'so-3',
      orderId: 'order-3',
      vendorId: 'vendor-1',
      status: ORDER_STATUS.SHIPPED,
      taxInvoiceNumber: null as string | null,
      taxInvoiceIssuedAt: null as Date | null,
      taxableAmountPaise: 10000,
      tcsAmountPaise: 50,
      tcsRatePercent: 0.5,
      taxBreakdown: { igst: 0 },
      shippingInvoiceSnapshot: { ...giftWrapSnapshot } as Record<string, unknown>,
    });
    const order = row({ id: 'order-3', platformInvoiceSnapshot: null });
    mock.method(SubOrder, 'findByPk', async () => sub as never);
    mock.method(Order, 'findByPk', async () => order as never);
    mock.method(TcsLedger, 'findOne', async () => null);
    // The rate has not changed since checkout: the frozen TCS stands.
    mock.method(settingsService, 'getPlatformSettings', async () => ({ tcsRatePercent: 0.5 }) as never);
    const tcs = mock.method(TcsLedger, 'create', async (values: Record<string, unknown>) => values as never);

    await issueTaxInvoicesOnDispatch('so-3', transaction);

    const shipping = sub.shippingInvoiceSnapshot as { invoiceNumber: string; issuedAt: string };
    assert.match(shipping.invoiceNumber, /^PLAT\//);
    assert.ok(shipping.issuedAt);
    assert.equal(tcs.mock.callCount(), 1);
    const collection = tcs.mock.calls[0]!.arguments[0] as Record<string, unknown>;
    assert.equal(collection.tcsAmountPaise, 50);
    assert.equal(collection.ratePercent, 0.5);
    assert.equal(collection.entryType, 'COLLECTION');
    // CGST = SGST on an intra-state supply.
    assert.equal(collection.tcsCgstPaise, collection.tcsSgstPaise);
  });

  it('takes TCS at the rate in force at dispatch when it changed after checkout', async () => {
    mockSequence();
    // Checked out at 0.5% TCS (₹0.50 on ₹100); the rate is 1% when the part ships.
    const sub = row({
      id: 'so-4',
      orderId: 'order-4',
      vendorId: 'vendor-1',
      status: ORDER_STATUS.SHIPPED,
      taxInvoiceNumber: null as string | null,
      taxInvoiceIssuedAt: null as Date | null,
      taxableAmountPaise: 10000,
      tcsAmountPaise: 50,
      tcsRatePercent: 0.5,
      netPayoutAmountPaise: 10750,
      taxBreakdown: { igst: 1800 },
      shippingInvoiceSnapshot: null,
    });
    const item = row({
      id: 'item-4',
      taxBreakdown: { igst: 18, gstPercentage: 18 },
      taxableAmountPaise: 10000,
      supplyTaxablePaise: 10000,
      taxAmountPaise: 1800,
      tcsAmountPaise: 50,
      netPayoutAmountPaise: 10750,
    });
    const ledger = row({ id: 'cl-4', status: 'PENDING', tcsAmountPaise: 50, netPayoutAmountPaise: 10750 });
    const order = row({ id: 'order-4', platformInvoiceSnapshot: null });
    mock.method(SubOrder, 'findByPk', async () => sub as never);
    mock.method(Order, 'findByPk', async () => order as never);
    mock.method(TcsLedger, 'findOne', async () => null);
    mock.method(settingsService, 'getPlatformSettings', async () => ({ tcsRatePercent: 1 }) as never);
    mock.method(CommissionLedger, 'findOne', async () => ledger as never);
    mock.method(OrderItem, 'findAll', async () => [item] as never);
    const tcs = mock.method(TcsLedger, 'create', async (values: Record<string, unknown>) => values as never);

    await issueTaxInvoicesOnDispatch('so-4', transaction);

    // ₹1 TCS now; the extra ₹0.50 comes out of the vendor's net on the item, part and ledger.
    assert.equal(sub.tcsAmountPaise, 100);
    assert.equal(sub.tcsRatePercent, 1);
    assert.equal(sub.netPayoutAmountPaise, 10700);
    assert.equal(item.tcsAmountPaise, 100);
    assert.equal(item.netPayoutAmountPaise, 10700);
    assert.equal(ledger.tcsAmountPaise, 100);
    assert.equal(ledger.netPayoutAmountPaise, 10700);
    const collection = tcs.mock.calls[0]!.arguments[0] as Record<string, unknown>;
    assert.equal(collection.tcsAmountPaise, 100);
    assert.equal(collection.ratePercent, 1);
  });

  it('keeps the TCS of a part whose sale was already paid out', async () => {
    mockSequence();
    const sub = row({
      id: 'so-5',
      orderId: 'order-5',
      vendorId: 'vendor-1',
      status: ORDER_STATUS.DELIVERED,
      taxInvoiceNumber: null as string | null,
      taxInvoiceIssuedAt: null as Date | null,
      taxableAmountPaise: 10000,
      tcsAmountPaise: 50,
      tcsRatePercent: 0.5,
      taxBreakdown: { igst: 1800 },
      shippingInvoiceSnapshot: null,
    });
    mock.method(SubOrder, 'findByPk', async () => sub as never);
    mock.method(Order, 'findByPk', async () => row({ id: 'order-5', platformInvoiceSnapshot: null }) as never);
    mock.method(TcsLedger, 'findOne', async () => null);
    mock.method(settingsService, 'getPlatformSettings', async () => ({ tcsRatePercent: 1 }) as never);
    mock.method(CommissionLedger, 'findOne', async () => row({ id: 'cl-5', status: 'SETTLED' }) as never);
    const items = mock.method(OrderItem, 'findAll', async () => [] as never);
    const tcs = mock.method(TcsLedger, 'create', async (values: Record<string, unknown>) => values as never);

    await issueTaxInvoicesOnDispatch('so-5', transaction);

    assert.equal(items.mock.callCount(), 0);
    assert.equal(sub.tcsAmountPaise, 50);
    assert.equal((tcs.mock.calls[0]!.arguments[0] as Record<string, unknown>).tcsAmountPaise, 50);
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

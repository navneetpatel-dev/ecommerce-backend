import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  formatInrAmount,
  formatInvoiceDate,
  formatInvoiceMoney,
  invoiceFundingMethodLabel,
  paymentMethodLabel,
  paymentStatusLabel,
  renderTaxInvoicePdf,
  rupeesInWords,
  toTaxInvoiceSource,
  toTaxInvoiceSourceFromSubOrder,
} from '../taxInvoicePdf';

describe('taxInvoicePdf formatters', () => {
  it('groups rupees with the Indian lakh/crore pattern', () => {
    assert.equal(formatInrAmount(291769.74), '2,91,769.74');
    assert.equal(formatInvoiceMoney(271371.3), 'Rs 2,71,371.30');
  });

  it('formats invoice dates from the UTC calendar day', () => {
    assert.equal(formatInvoiceDate(new Date('2026-08-31T18:30:00.000Z')), '31 Aug 2026');
  });

  it('maps payment labels for the invoice header', () => {
    assert.equal(paymentMethodLabel('RAZORPAY'), 'Razorpay');
    assert.equal(paymentMethodLabel('COD'), 'Cash on delivery');
    assert.equal(paymentMethodLabel(null), '--');
    assert.equal(paymentStatusLabel('PENDING'), 'Pending');
    assert.equal(paymentStatusLabel('PAID'), 'Paid');
  });

  it('maps invoice funding method from wallet split', () => {
    assert.equal(
      invoiceFundingMethodLabel({
        paymentMethod: 'RAZORPAY',
        walletAmountUsed: 250,
        razorpayAmountPaid: 0,
        totalAmount: 250,
      }),
      'Wallet',
    );
    assert.equal(
      invoiceFundingMethodLabel({
        paymentMethod: 'RAZORPAY',
        walletAmountUsed: 50,
        razorpayAmountPaid: 200,
        totalAmount: 250,
      }),
      'Wallet + Razorpay',
    );
    assert.equal(
      invoiceFundingMethodLabel({
        paymentMethod: 'RAZORPAY',
        walletAmountUsed: 0,
        razorpayAmountPaid: 250,
        totalAmount: 250,
      }),
      'Razorpay',
    );
  });

  it('converts amounts to Indian-system words', () => {
    assert.equal(
      rupeesInWords(310516.87),
      'Rupees Three Lakh Ten Thousand Five Hundred Sixteen and Eighty Seven Paise Only',
    );
  });
});

describe('renderTaxInvoicePdf', () => {
  it('writes a non-empty PDF buffer', async () => {
    const pdf = await renderTaxInvoicePdf({
      invoiceNo: 'TW/2526/00000001',
      orderId: '992c2f63-a976-4600-bfec-169f675305f8',
      invoiceDate: new Date('2026-08-31T00:00:00.000Z'),
      paymentMethod: 'RAZORPAY',
      paymentStatus: 'PENDING',
      totalAmount: 310516.87,
      buyerName: 'Ada Lovelace',
      shippingAddress: {
        line1: '604 MG Road',
        city: 'Chennai',
        state: 'Tamil Nadu',
        pincode: '16355',
        country: 'India',
      },
      seller: {
        businessName: 'TechWorld',
        gstNumber: '29AABC0000N1Z1',
        state: 'Karnataka',
        items: [
          {
            productName: 'Electronics Max 222',
            sku: 'EL-222',
            hsn: '--',
            quantity: 95,
            unitPrice: 2856.54,
            taxable: 271371.3,
            cgst: 0,
            sgst: 0,
            igst: 13568.56,
          },
        ],
      },
    });
    assert.ok(pdf.length > 1000);
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  });

  it('renders wallet funding meta without shrinking grand total', async () => {
    const pdf = await renderTaxInvoicePdf({
      invoiceNo: 'TW/2526/00000009',
      orderId: 'wallet-order-1',
      invoiceDate: new Date('2026-08-31T00:00:00.000Z'),
      paymentMethod: 'RAZORPAY',
      paymentStatus: 'PAID',
      walletAmountUsed: 100,
      razorpayAmountPaid: 150,
      totalAmount: 250,
      buyerName: 'Ada Lovelace',
      seller: {
        businessName: 'TechWorld',
        gstNumber: '29AABC0000N1Z1',
        state: 'Karnataka',
        items: [
          {
            productName: 'Gadget',
            sku: 'G-1',
            hsn: '8517',
            quantity: 1,
            unitPrice: 211.86,
            taxable: 211.86,
            cgst: 0,
            sgst: 0,
            igst: 38.14,
          },
        ],
      },
    });
    assert.ok(pdf.length > 1000);
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  });
});

describe('toTaxInvoiceSourceFromSubOrder', () => {
  it('maps a single sub-order with HSN and customerTotal', () => {
    const source = toTaxInvoiceSourceFromSubOrder(
      {
        id: '992c2f63-a976-4600-bfec-169f675305f8',
        createdAt: new Date('2026-08-31T00:00:00.000Z'),
        paymentMethod: 'RAZORPAY',
        paymentStatus: 'PENDING',
        user: { name: 'Ada Lovelace' },
        shippingAddress: {
          line1: '604 MG Road',
          line2: null,
          city: 'Chennai',
          state: 'Tamil Nadu',
          pincode: '16355',
          country: 'India',
        },
      },
      {
        id: 'sub-1',
        taxInvoiceNumber: 'TW/2526/00000001',
        taxInvoiceIssuedAt: new Date('2026-08-31T00:00:00.000Z'),
        customerTotal: 284939.86,
        vendor: {
          businessName: 'TechWorld',
          gstNumber: '29AABC0000N1Z1',
          state: 'Karnataka',
        },
        items: [
          {
            productName: 'Electronics Max 222',
            quantity: 95,
            unitPrice: 2856.54,
            taxableAmount: 271371.3,
            taxBreakdown: { cgst: 0, sgst: 0, igst: 13568.56 },
            variant: { sku: 'EL-222', product: { categoryId: 'cat-a' } },
          },
        ],
      },
      new Map([['cat-a', 'HSN00001234']]),
    );

    assert.equal(source.invoiceNo, 'TW/2526/00000001');
    assert.equal(source.buyerName, 'Ada Lovelace');
    assert.equal(source.totalAmount, 284939.86);
    assert.equal(source.seller.items[0]?.hsn, 'HSN00001234');
  });

  it('threads walletAmountUsed and razorpayAmountPaid from the order', () => {
    const source = toTaxInvoiceSourceFromSubOrder(
      {
        id: 'wallet-order',
        createdAt: new Date('2026-08-31T00:00:00.000Z'),
        paymentMethod: 'RAZORPAY',
        paymentStatus: 'PAID',
        walletAmountUsed: 100,
        razorpayAmountPaid: 184.86,
        user: { name: 'Ada Lovelace' },
      },
      {
        id: 'sub-wallet',
        taxInvoiceNumber: 'TW/2526/00000010',
        taxInvoiceIssuedAt: new Date('2026-08-31T00:00:00.000Z'),
        customerTotal: 284.86,
        vendor: {
          businessName: 'TechWorld',
          gstNumber: '29AABC0000N1Z1',
          state: 'Karnataka',
        },
        items: [
          {
            productName: 'Gadget',
            quantity: 1,
            unitPrice: 241.41,
            taxableAmount: 241.41,
            taxBreakdown: { cgst: 0, sgst: 0, igst: 43.45 },
            variant: { sku: 'G-1', product: { categoryId: 'cat-a' } },
          },
        ],
      },
      new Map([['cat-a', '8517']]),
    );

    assert.equal(source.walletAmountUsed, 100);
    assert.equal(source.razorpayAmountPaid, 184.86);
    assert.equal(source.totalAmount, 284.86);
  });

  it('preserves DECIMAL strings on unit price and tax', () => {
    const source = toTaxInvoiceSource(
      'DD/2526/00000002',
      {
        id: '16aa306c-3cf5-4685-a5ad-d810563c9cb5',
        createdAt: new Date('2026-08-31T00:00:00.000Z'),
        paymentMethod: 'RAZORPAY',
        paymentStatus: 'PENDING',
        totalAmount: '2364.16' as unknown as number,
        subOrders: [
          {
            id: 'sub-2',
            taxInvoiceNumber: 'DD/2526/00000002',
            customerTotal: 2364.16,
            vendor: { businessName: 'DecorDen' },
            items: [
              {
                productName: 'Furniture Pro 286',
                quantity: 1,
                unitPrice: '1847.00' as unknown as number,
                taxableAmount: '1847.00' as unknown as number,
                taxBreakdown: { cgst: '0.00', sgst: '0.00', igst: '517.16' },
              },
            ],
          },
        ],
      },
      new Map(),
    );

    assert.equal(source.totalAmount, 2364.16);
    assert.equal(source.seller.items[0]?.unitPrice, 1847);
    assert.equal(source.seller.items[0]?.igst, 517.16);
  });

  it('ignores stale tax breakdown on returned lines', () => {
    const source = toTaxInvoiceSourceFromSubOrder(
      {
        id: 'returned-order',
        createdAt: new Date('2026-08-31T00:00:00.000Z'),
        paymentMethod: 'RAZORPAY',
        paymentStatus: 'PAID',
      },
      {
        id: 'sub-3',
        taxInvoiceNumber: 'DD/2526/00000003',
        customerTotal: 0,
        vendor: { businessName: 'DecorDen' },
        items: [
          {
            productName: 'Returned item',
            quantity: 1,
            unitPrice: 1847,
            taxableAmount: 0,
            taxAmount: 0,
            taxBreakdown: { cgst: 0, sgst: 0, igst: 517.16 },
          },
        ],
      },
      new Map(),
    );

    const line = source.seller.items[0];
    assert.equal(line?.taxable, 0);
    assert.equal(line?.cgst, 0);
    assert.equal(line?.sgst, 0);
    assert.equal(line?.igst, 0);
    assert.equal(source.totalAmount, 0);
  });

  it('renders the amounts issued at checkout, not the lines a return rewrote', () => {
    const source = toTaxInvoiceSourceFromSubOrder(
      {
        id: 'order-snap',
        createdAt: new Date('2026-09-01T00:00:00.000Z'),
        paymentMethod: 'RAZORPAY',
        paymentStatus: 'PAID',
      },
      {
        id: 'sub-snap',
        taxInvoiceNumber: 'SN/2627/00000001',
        taxInvoiceIssuedAt: new Date('2026-09-01T00:00:00.000Z'),
        // After one of two units was returned.
        customerTotal: 590,
        items: [
          {
            id: 'item-1',
            productName: 'Brass Lamp',
            quantity: 1,
            unitPrice: 500,
            taxableAmount: 500,
            taxAmount: 90,
            taxBreakdown: { cgst: 45, sgst: 45, igst: 0 },
            variant: { sku: 'BL-1', product: { categoryId: 'cat-a' } },
          },
        ],
        taxInvoiceSnapshot: {
          totalPaise: 118001,
          lines: [
            {
              orderItemId: 'item-1',
              quantity: 2,
              unitPricePaise: 50000,
              taxablePaise: 100001,
              cgstPaise: 9000,
              sgstPaise: 9000,
              igstPaise: 0,
            },
          ],
        },
      },
      new Map([['cat-a', '9405']]),
    );

    const line = source.seller.items[0];
    assert.equal(line?.productName, 'Brass Lamp');
    assert.equal(line?.hsn, '9405');
    assert.equal(line?.sku, 'BL-1');
    assert.equal(line?.quantity, 2);
    assert.equal(line?.taxable, 1000.01);
    assert.equal(line?.cgst, 90);
    assert.equal(line?.sgst, 90);
    assert.equal(source.totalAmount, 1180.01);
  });
});

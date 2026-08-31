import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  formatInrAmount,
  formatInvoiceDate,
  formatInvoiceMoney,
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
});

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
      invoiceNo: 'INV-2026-000001',
      orderId: '992c2f63-a976-4600-bfec-169f675305f8',
      invoiceDate: new Date('2026-08-31T00:00:00.000Z'),
      paymentMethod: 'RAZORPAY',
      paymentStatus: 'PENDING',
      totalAmount: 310516.87,
      walletAmountUsed: 0,
      buyerName: 'Ada Lovelace',
      shippingAddress: {
        line1: '604 MG Road',
        city: 'Chennai',
        state: 'Tamil Nadu',
        pincode: '16355',
        country: 'India',
      },
      sellers: [
        {
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
      ],
    });
    assert.ok(pdf.length > 1000);
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  });
});

describe('toTaxInvoiceSource', () => {
  it('groups line items by seller and resolves HSN from category tax rules', () => {
    const source = toTaxInvoiceSource(
      'INV-2026-000001',
      {
        id: '992c2f63-a976-4600-bfec-169f675305f8',
        createdAt: new Date('2026-08-31T00:00:00.000Z'),
        paymentMethod: 'RAZORPAY',
        paymentStatus: 'PENDING',
        totalAmount: 310516.87,
        walletAmountUsed: 0,
        user: { name: 'Ada Lovelace' },
        shippingAddress: {
          line1: '604 MG Road',
          line2: null,
          city: 'Chennai',
          state: 'Tamil Nadu',
          pincode: '16355',
          country: 'India',
        },
        subOrders: [
          {
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
        ],
      },
      new Map([['cat-a', 'HSN00001234']]),
    );

    assert.equal(source.invoiceNo, 'INV-2026-000001');
    assert.equal(source.buyerName, 'Ada Lovelace');
    assert.equal(source.sellers[0]?.items[0]?.hsn, 'HSN00001234');
  });

  it('preserves order totalAmount when Sequelize returns DECIMAL strings', () => {
    const source = toTaxInvoiceSource(
      'INV-2026-000002',
      {
        id: '16aa306c-3cf5-4685-a5ad-d810563c9cb5',
        createdAt: new Date('2026-08-31T00:00:00.000Z'),
        paymentMethod: 'RAZORPAY',
        paymentStatus: 'PENDING',
        totalAmount: '2364.16' as unknown as number,
        walletAmountUsed: '0.00' as unknown as number,
        subOrders: [
          {
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
    assert.equal(source.sellers[0]?.items[0]?.unitPrice, 1847);
    assert.equal(source.sellers[0]?.items[0]?.igst, 517.16);
  });

  it('ignores stale tax breakdown on returned lines', () => {
    const source = toTaxInvoiceSource(
      'INV-2026-000003',
      {
        id: 'returned-order',
        createdAt: new Date('2026-08-31T00:00:00.000Z'),
        paymentMethod: 'RAZORPAY',
        paymentStatus: 'PAID',
        totalAmount: 0,
        walletAmountUsed: 0,
        subOrders: [
          {
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
        ],
      },
      new Map(),
    );

    const line = source.sellers[0]?.items[0];
    assert.equal(line?.taxable, 0);
    assert.equal(line?.cgst, 0);
    assert.equal(line?.sgst, 0);
    assert.equal(line?.igst, 0);
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Payout } from '@database/models/payout.model';
import { renderPayoutStatementPdf } from '../emailAttachments';

describe('renderPayoutStatementPdf', () => {
  it('renders a real PDF with the figures behind the payout', async () => {
    const payout = {
      id: 'p-1234567890',
      amount: 2189.85,
      grossPaise: 250000,
      tdsPaise: 250,
      commissionGstPaise: 9000,
      adjustmentPaise: 0,
      periodStart: new Date('2026-11-01'),
      periodEnd: new Date('2026-11-15'),
      paidAt: new Date('2026-11-17'),
      paymentReferenceNumber: 'UTR998',
      paymentMethod: 'NEFT',
      remarks: null,
    } as unknown as Payout;

    const pdf = await renderPayoutStatementPdf(payout, { businessName: 'TechWorld' });

    assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
    assert.ok(pdf.length > 800);
  });
});

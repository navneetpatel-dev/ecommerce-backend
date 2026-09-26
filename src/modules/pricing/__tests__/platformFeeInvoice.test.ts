import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  giftWrapInvoiceLine,
  gstInclusiveSplit,
  platformInvoiceLineTotalPaise,
} from '../platformFeeInvoice';
import { isIntraStateSupply } from '../gstPlaceOfSupply';

describe('gift-wrap GST', () => {
  it('splits the ₹49 fee into ₹41.53 taxable and ₹7.47 GST, adding up exactly', () => {
    assert.deepEqual(gstInclusiveSplit(4900, 18, true), {
      taxablePaise: 4153,
      cgst: 373,
      sgst: 374,
      igst: 0,
    });
    const interState = giftWrapInvoiceLine(49, false);
    assert.equal(interState.taxablePaise, 4153);
    assert.equal(interState.igstPaise, 747);
    assert.equal(interState.cgstPaise + interState.sgstPaise, 0);
    assert.equal(platformInvoiceLineTotalPaise(interState), 4900);
    assert.equal(interState.sac, '9985');
  });

  it('is intra-state when the platform and place of supply share a state', () => {
    assert.equal(isIntraStateSupply('Karnataka', ' karnataka '), true);
    assert.equal(isIntraStateSupply('Karnataka', 'Tamil Nadu'), false);
    // Platform state not configured yet: CGST + SGST.
    assert.equal(isIntraStateSupply('', 'Tamil Nadu'), true);
  });
});

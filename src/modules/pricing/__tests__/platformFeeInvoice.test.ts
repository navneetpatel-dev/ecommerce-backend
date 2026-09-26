import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  giftWrapInvoiceLine,
  gstInclusiveSplit,
  platformInvoiceLineTotalPaise,
} from '../platformFeeInvoice';
import { isIntraStateSupply } from '../gstPlaceOfSupply';

describe('gift-wrap GST', () => {
  it('splits the ₹49 fee into taxable value and GST, adding up exactly, CGST = SGST', () => {
    // Intra-state: ₹41.52 + CGST ₹3.74 + SGST ₹3.74 (equal halves, as on a GST invoice).
    assert.deepEqual(gstInclusiveSplit(4900, 18, true), {
      taxablePaise: 4152,
      cgst: 374,
      sgst: 374,
      igst: 0,
    });
    // Inter-state: ₹41.53 + IGST ₹7.47.
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

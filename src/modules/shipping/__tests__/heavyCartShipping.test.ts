import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { ShippingRate } from '@database/models/shippingRate.model';
import { settingsService } from '@modules/settings/settings.service';
import { shippingService, slabParcelsCost } from '../shipping.service';

describe('shipping above the highest weight slab', () => {
  afterEach(() => mock.restoreAll());

  it('charges one top-slab price per parcel of that slab weight', () => {
    assert.equal(slabParcelsCost(150, 15_000, 15_000), 150);
    assert.equal(slabParcelsCost(150, 15_000, 15_001), 300);
    assert.equal(slabParcelsCost(150, 15_000, 45_000), 450);
    assert.equal(slabParcelsCost(99.99, 8_000, 20_000), 299.97);
  });

  it('quotes a 45 kg part at three 15 kg parcels, not one', async () => {
    mock.method(settingsService, 'getPlatformSettings', async () => ({ freeShippingThreshold: null }) as never);
    mock.method(shippingService, 'resolveZonesForPincode', async () => [{ id: 'zone-1' }] as never);
    const topSlab = {
      vendorId: null,
      method: 'STANDARD',
      price: 150,
      maxWeightGrams: 15_000,
      freeShippingThreshold: null,
      estimatedDays: 4,
      zoneId: 'zone-1',
    };
    mock.method(ShippingRate, 'findAll', async () => [topSlab] as never);

    const [rate] = await shippingService.getRatesForQuote({ pincode: '400001', weightGrams: 45_000 });
    assert.equal(rate?.cost, 450);
  });

  it('offers each method at every weight: a covering slab, else its top slab per parcel', async () => {
    mock.method(settingsService, 'getPlatformSettings', async () => ({ freeShippingThreshold: null }) as never);
    mock.method(shippingService, 'resolveZonesForPincode', async () => [{ id: 'zone-1' }] as never);
    const slab = (method: string, price: number, maxWeightGrams: number) => ({
      vendorId: null, method, price, maxWeightGrams, freeShippingThreshold: null, estimatedDays: 3, zoneId: 'zone-1',
    });
    // Ordered as the query orders them: highest slab first, cheapest first.
    mock.method(ShippingRate, 'findAll', async () => [
      slab('STANDARD', 150, 15_000),
      slab('EXPRESS', 120, 8_000),
      slab('STANDARD', 90, 10_000),
    ] as never);
    const rates = await shippingService.getRatesForQuote({ pincode: '400001', weightGrams: 12_000 });
    const cost = Object.fromEntries(rates.map((rate) => [rate.method, rate.cost]));
    // 12 kg: STANDARD's 15 kg slab covers it; EXPRESS tops out at 8 kg → two parcels.
    assert.deepEqual(cost, { STANDARD: 150, EXPRESS: 240 });
  });

  it('keeps the slab price for a part within a slab', async () => {
    mock.method(settingsService, 'getPlatformSettings', async () => ({ freeShippingThreshold: null }) as never);
    mock.method(shippingService, 'resolveZonesForPincode', async () => [{ id: 'zone-1' }] as never);
    mock.method(ShippingRate, 'findAll', async () => [
      { vendorId: null, method: 'STANDARD', price: 60, maxWeightGrams: 2_000, freeShippingThreshold: null, estimatedDays: 4, zoneId: 'zone-1' },
    ] as never);
    const [rate] = await shippingService.getRatesForQuote({ pincode: '400001', weightGrams: 1_500 });
    assert.equal(rate?.cost, 60);
  });
});

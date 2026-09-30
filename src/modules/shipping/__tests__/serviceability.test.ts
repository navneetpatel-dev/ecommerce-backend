import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { ShippingRate } from '@database/models/shippingRate.model';
import { ShippingZone } from '@database/models/shippingZone.model';
import { settingsService } from '@modules/settings/settings.service';
import { shippingService } from '../shipping.service';

/** A zone only matches a pincode through its prefixes, so the stub needs at least one. */
function stubZones(zones: Array<{ id: string }>) {
  mock.method(ShippingZone, 'findAll', async () => zones.map((zone) => ({ pincodePrefixes: ['560'], states: [], ...zone })) as never);
}

function stubPlatformSettings(freeShippingThreshold?: number) {
  mock.method(
    settingsService,
    'getPlatformSettings',
    async () =>
      ({
        freeShippingThreshold,
      }) as Awaited<ReturnType<typeof settingsService.getPlatformSettings>>,
  );
}

function rate(partial: { method: string; estimatedDays: number; vendorId?: string | null; freeShippingThreshold?: number | null }) {
  return {
    price: 59,
    freeShippingThreshold: null,
    vendorId: null,
    ...partial,
  } as never;
}

function stubRates(rates: unknown[]) {
  mock.method(ShippingRate, 'findAll', async () => rates as never);
}

/**
 * The funnel hard-gates on this answer (PDP, cart, address step), so the two ways of being
 * unserviceable — no zone at all, and a zone that carries no rate for one of the basket's
 * vendors — both have to read as a "no", per vendor as well as overall.
 */
describe('shippingService.checkServiceability', () => {
  afterEach(() => mock.restoreAll());

  it('reports a pincode no zone covers as unserviceable, per vendor and overall', async () => {
    stubZones([]);

    const result = await shippingService.checkServiceability({
      pincode: '999999',
      vendorIds: ['vendor-1'],
    });

    assert.equal(result.serviceable, false);
    assert.deepEqual(result.vendors, [
      {
        vendorId: 'vendor-1',
        serviceable: false,
        methods: [],
        estimatedDays: null,
        freeShippingThreshold: null,
      },
    ]);
    assert.deepEqual(result.methods, []);
    assert.equal(result.estimatedDays, null);
    assert.equal(result.pincode, '999999');
  });

  it('serves a vendor through its own rates in the zone', async () => {
    stubZones([{ id: 'zone-1' }]);
    stubPlatformSettings();
    stubRates([rate({ method: 'EXPRESS', estimatedDays: 2, vendorId: 'vendor-1' })]);

    const result = await shippingService.checkServiceability({
      pincode: '560001',
      vendorIds: ['vendor-1'],
    });

    assert.equal(result.serviceable, true);
    assert.deepEqual(result.vendors[0], {
      vendorId: 'vendor-1',
      serviceable: true,
      methods: ['EXPRESS'],
      estimatedDays: { min: 2, max: 2 },
      freeShippingThreshold: null,
    });
  });

  it('falls back to the platform-wide rate when the vendor has none there', async () => {
    stubZones([{ id: 'zone-1' }]);
    stubPlatformSettings();
    stubRates([rate({ method: 'STANDARD', estimatedDays: 6 })]);

    const result = await shippingService.checkServiceability({
      pincode: '560001',
      vendorIds: ['vendor-1'],
    });

    assert.equal(result.serviceable, true);
    assert.deepEqual(result.vendors[0]?.methods, ['STANDARD']);
  });

  it('keeps a vendor unserviceable when only another vendor has rates in the zone', async () => {
    stubZones([{ id: 'zone-1' }]);
    stubPlatformSettings();
    stubRates([rate({ method: 'STANDARD', estimatedDays: 6, vendorId: 'vendor-2' })]);

    const result = await shippingService.checkServiceability({
      pincode: '560001',
      vendorIds: ['vendor-1', 'vendor-2'],
    });

    assert.equal(result.serviceable, false);
    assert.equal(result.vendors[0]?.serviceable, false);
    assert.equal(result.vendors[1]?.serviceable, true);
  });

  it('answers for the whole zone when no vendor is given', async () => {
    stubZones([{ id: 'zone-1' }]);
    stubPlatformSettings();
    stubRates([
      rate({ method: 'STANDARD', estimatedDays: 6, vendorId: 'vendor-2' }),
      rate({ method: 'EXPRESS', estimatedDays: 3, vendorId: 'vendor-2' }),
    ]);

    const result = await shippingService.checkServiceability({ pincode: '560001' });

    assert.equal(result.serviceable, true);
    assert.deepEqual(result.vendors, []);
    assert.deepEqual(result.methods, ['EXPRESS', 'STANDARD']);
    assert.deepEqual(result.estimatedDays, { min: 3, max: 6 });
  });

  it('reports the fastest and slowest days and the lowest free-shipping threshold', async () => {
    stubZones([{ id: 'zone-1' }]);
    stubPlatformSettings(2_000);
    stubRates([
      rate({
        method: 'STANDARD',
        estimatedDays: 7,
        freeShippingThreshold: 1_500,
      }),
      rate({ method: 'EXPRESS', estimatedDays: 2 }),
    ]);

    const result = await shippingService.checkServiceability({
      pincode: '560001',
      vendorIds: ['vendor-1'],
    });

    assert.deepEqual(result.vendors[0]?.estimatedDays, { min: 2, max: 7 });
    // The rate's own threshold wins over the platform-wide 2000.
    assert.equal(result.vendors[0]?.freeShippingThreshold, 1_500);
    assert.deepEqual(result.estimatedDays, { min: 2, max: 7 });
  });

  it('reports no rates in a covered zone as unserviceable', async () => {
    stubZones([{ id: 'zone-1' }]);
    stubPlatformSettings();
    stubRates([]);

    const result = await shippingService.checkServiceability({ pincode: '560001' });

    assert.equal(result.serviceable, false);
    assert.equal(result.estimatedDays, null);
  });
});

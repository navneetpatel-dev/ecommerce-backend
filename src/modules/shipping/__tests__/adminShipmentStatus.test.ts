import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { sequelize } from '@database/models';
import { Shipment } from '@database/models/shipment.model';
import { ShipmentAttempt } from '@database/models/shipmentAttempt.model';
import { AuditLog } from '@database/models/auditLog.model';
import { ValidationError } from '@core/errors/ValidationError';
import { shippingService } from '../shipping.service';

type ShipmentStub = {
  id: string;
  subOrderId: string;
  status: string;
  codAmount: number | null;
  failedAttemptCount: number;
};

function stubShipment(fields: Partial<ShipmentStub>): ShipmentStub {
  const shipment: ShipmentStub = {
    id: 'shipment-1',
    subOrderId: 'sub-1',
    status: 'OUT_FOR_DELIVERY',
    codAmount: null,
    failedAttemptCount: 0,
    ...fields,
  };
  mock.method(Shipment, 'findByPk', async () => shipment);
  return shipment;
}

describe('adminUpdateShipmentStatus', () => {
  afterEach(() => mock.restoreAll());

  function stubTransactionAndAudit() {
    mock.method(sequelize, 'transaction', async (callback: (t: unknown) => Promise<unknown>) =>
      callback({ LOCK: { UPDATE: 'UPDATE' }, afterCommit: (fn: () => void) => fn() }),
    );
    mock.method(AuditLog, 'create', async () => ({}));
  }

  it('refuses a move the shipment cannot make', async () => {
    stubTransactionAndAudit();
    stubShipment({ status: 'DELIVERED' });
    const apply = mock.method(shippingService, 'applyShipmentStatus', async (s: unknown) => s);
    await assert.rejects(
      shippingService.adminUpdateShipmentStatus('shipment-1', 'admin-1', { status: 'FAILED', reason: 'Door locked' }),
      ValidationError,
    );
    assert.equal(apply.mock.callCount(), 0);
  });

  it('needs to know whether COD cash was collected before marking a COD parcel delivered', async () => {
    stubTransactionAndAudit();
    stubShipment({ codAmount: 750 });
    const apply = mock.method(shippingService, 'applyShipmentStatus', async (s: unknown) => s);
    await assert.rejects(
      shippingService.adminUpdateShipmentStatus('shipment-1', 'admin-1', { status: 'DELIVERED' }),
      ValidationError,
    );
    assert.equal(apply.mock.callCount(), 0);

    await shippingService.adminUpdateShipmentStatus('shipment-1', 'admin-1', { status: 'DELIVERED', codCollected: true });
    assert.equal(apply.mock.callCount(), 1);
    const [, status, extra] = apply.mock.calls[0]!.arguments as [unknown, string, Record<string, unknown>];
    assert.equal(status, 'DELIVERED');
    assert.equal(extra.codCollected, true);
    assert.ok(extra.codCollectedAt instanceof Date);
  });

  it('records a delivery left uncollected as uncollected', async () => {
    stubTransactionAndAudit();
    stubShipment({ codAmount: 750 });
    const apply = mock.method(shippingService, 'applyShipmentStatus', async (s: unknown) => s);
    await shippingService.adminUpdateShipmentStatus('shipment-1', 'admin-1', { status: 'DELIVERED', codCollected: false });
    const [, , extra] = apply.mock.calls[0]!.arguments as [unknown, string, Record<string, unknown>];
    assert.equal(extra.codCollected, false);
    assert.equal(extra.codCollectedAt, null);
  });

  it('records a failed attempt with its reason in the attempt history', async () => {
    stubTransactionAndAudit();
    stubShipment({ failedAttemptCount: 1 });
    const apply = mock.method(shippingService, 'applyShipmentStatus', async (s: unknown) => s);
    const attempts = mock.method(ShipmentAttempt, 'create', async (values: unknown) => values);

    await assert.rejects(
      shippingService.adminUpdateShipmentStatus('shipment-1', 'admin-1', { status: 'FAILED' }),
      ValidationError,
    );
    assert.equal(apply.mock.callCount(), 0);

    await shippingService.adminUpdateShipmentStatus('shipment-1', 'admin-1', {
      status: 'FAILED',
      reason: 'Customer not at home',
    });
    const [, , extra] = apply.mock.calls[0]!.arguments as [unknown, string, Record<string, unknown>];
    assert.equal(extra.failureReason, 'Customer not at home');
    assert.equal(attempts.mock.callCount(), 1);
    const attempt = attempts.mock.calls[0]!.arguments[0] as Record<string, unknown>;
    assert.equal(attempt.attemptNumber, 2);
    assert.equal(attempt.note, 'Customer not at home');
  });

  it('stamps when a returned parcel was received back', async () => {
    stubTransactionAndAudit();
    stubShipment({ status: 'RTO_INITIATED' });
    const apply = mock.method(shippingService, 'applyShipmentStatus', async (s: unknown) => s);
    await shippingService.adminUpdateShipmentStatus('shipment-1', 'admin-1', { status: 'RTO_DELIVERED' });
    const [, status, extra] = apply.mock.calls[0]!.arguments as [unknown, string, Record<string, unknown>];
    assert.equal(status, 'RTO_DELIVERED');
    assert.ok(extra.rtoConfirmedAt instanceof Date);
  });
});

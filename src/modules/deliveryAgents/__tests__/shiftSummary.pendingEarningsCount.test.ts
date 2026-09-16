import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { Shipment } from '@database/models/shipment.model';
import { ReturnRequest } from '@database/models/returnRequest.model';
import { DeliveryCashDeposit } from '@database/models/deliveryCashDeposit.model';
import { DeliveryAgentEarning } from '@database/models/deliveryAgentEarning.model';
import { settingsService } from '@modules/settings/settings.service';
import { deliveryAgentsService } from '../deliveryAgents.service';

describe('deliveryAgentsService.shiftSummary pendingEarningsCount', () => {
  afterEach(() => mock.restoreAll());

  it('returns pendingEarningsCount equal to pending earnings row count', async () => {
    mock.method(Shipment, 'count', async () => 0);
    mock.method(Shipment, 'findAll', async () => []);
    mock.method(ReturnRequest, 'count', async () => 0);
    mock.method(DeliveryCashDeposit, 'findAll', async () => []);
    mock.method(DeliveryCashDeposit, 'count', async () => 0);
    mock.method(settingsService, 'getPlatformSettings', async () => ({
      deliveryAgentPerTaskEarning: 50,
    }));
    mock.method(DeliveryAgentEarning, 'findAll', async (opts: { where?: { status?: string } }) => {
      if (opts?.where?.status === 'PENDING') {
        return [{ amount: 10 }, { amount: 25.5 }, { amount: 4.5 }];
      }
      return [];
    });

    const summary = await deliveryAgentsService.shiftSummary('agent-1');
    assert.equal(summary.pendingEarningsCount, 3);
    assert.equal(summary.pendingEarnings, 40);
  });
});

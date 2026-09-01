import { Op } from 'sequelize';
import { logger } from '@core/logger';
import { ReturnRequest } from '@database/models/returnRequest.model';
import { REFUND_STATUS } from '@core/constants/statuses';
import { returnsService } from '@modules/returns/returns.service';

export const REFUND_RETRY_JOB = 'refund-retry';

const MAX_ATTEMPTS = 5;

export async function runRefundRetry(): Promise<{ retried: number; failed: number }> {
  const rows = await ReturnRequest.findAll({
    where: {
      refundStatus: REFUND_STATUS.FAILED,
      razorpayRefundAmount: { [Op.gt]: 0 },
      refundAttemptCount: { [Op.lt]: MAX_ATTEMPTS },
    },
    limit: 50,
    order: [['lastRefundAttemptAt', 'ASC']],
  });

  let retried = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      await returnsService.retryRazorpayRefund(row.id, 'system');
      retried += 1;
    } catch (err) {
      failed += 1;
      logger.warn('Refund retry failed', {
        returnId: row.id,
        error: err instanceof Error ? err.message : err,
      });
    }
  }

  logger.info('Refund retry job finished', { retried, failed });
  return { retried, failed };
}

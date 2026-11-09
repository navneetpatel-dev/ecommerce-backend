/**
 * Prices every seeded order with the checkout engine, then fills in what checkout and the
 * order's later life would have written around those prices: commission ledgers on the
 * part figures, what was paid online, COD to collect, card refunds for cancellations,
 * and the platform's gift-wrap invoice.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { exec, select } from './lib';
import { giftWrapInvoiceLine, platformInvoiceLineTotalPaise } from '../../src/modules/pricing/platformFeeInvoice';
import { isIntraStateSupply } from '../../src/modules/pricing/gstPlaceOfSupply';
import { settingsService } from '../../src/modules/settings/settings.service';
import { sequelize } from '../../database/models';

const SHARDS = 4;
/** Section 52 TCS the marketplace collects, as the platform settings default it. */
const TCS_RATE_PERCENT = 0.5;

/** Runs the backfill: one shard of n, or (index null) a single pass over whatever is left. */
function runShard(index: number | null): Promise<number> {
  const script = path.resolve(__dirname, '..', 'backfill-seeded-order-money.ts');
  const shard = index == null ? [] : ['--shard', `${index}/${SHARDS}`];
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [...process.execArgv, script, '--apply', '--quiet', ...shard, '--tcs-rate', String(TCS_RATE_PERCENT)],
      { stdio: ['ignore', 'pipe', 'pipe'], env: process.env },
    );
    let failures = 0;
    const relay = (chunk: Buffer, toError: boolean) => {
      for (const line of chunk.toString().split('\n').filter(Boolean)) {
        if (line.includes('FAIL ')) failures += 1;
        if (toError || /order\(s\)|Verified|still fail/.test(line)) console.log(`  [${index == null ? 'final pass' : `shard ${index}`}] ${line.trim()}`);
      }
    };
    child.stdout.on('data', (chunk: Buffer) => relay(chunk, false));
    child.stderr.on('data', (chunk: Buffer) => relay(chunk, true));
    child.on('error', reject);
    child.on('close', () => resolve(failures));
  });
}

export async function priceOrders(): Promise<void> {
  await Promise.all(Array.from({ length: SHARDS }, (_, index) => runShard(index)));
  // Shards can trip over each other numbering invoices for the same vendor; whatever was
  // rolled back is priced now, alone, where nothing competes for the locks.
  const total = await runShard(null);
  const [left] = await select<{ c: string }>('SELECT count(*)::text AS c FROM orders WHERE "taxTotal" IS NULL');
  console.log(total === 0 && left!.c === '0' ? '  every order priced and passed the display check' : `  ${total} order(s) failed the display check; ${left!.c} unpriced`);

  // Ledgers book exactly what the part was priced at.
  await exec(`
    UPDATE commission_ledgers l SET
      "saleAmountPaise" = COALESCE(s."taxableAmountPaise", l."saleAmountPaise"),
      "commissionAmountPaise" = COALESCE(s."commissionAmountPaise", l."commissionAmountPaise"),
      "taxableAmountPaise" = s."taxableAmountPaise", "discountAmountPaise" = s."discountAmountPaise",
      "taxAmountPaise" = s."taxAmountPaise", "tcsAmountPaise" = s."tcsAmountPaise",
      "netPayoutAmountPaise" = s."netPayoutAmountPaise", "supplyTaxablePaise" = s."supplyTaxablePaise",
      "shippingCollectedPaise" = GREATEST(0, COALESCE(s."shippingCostPaise", 0) - COALESCE(s."shippingDiscountAmountPaise", 0))
    FROM sub_orders s WHERE s.id = l."subOrderId" AND s."taxableAmountPaise" IS NOT NULL`);

  // What the customer paid and how: the whole bill online, or on delivery.
  await exec(`
    UPDATE orders SET "originalTotalAmount" = "totalAmount", "walletAmountUsed" = 0,
      "amountDue" = CASE WHEN "paymentStatus" = 'PENDING' AND "paymentMethod" = 'RAZORPAY' THEN "totalAmount" ELSE 0 END,
      "razorpayAmountPaid" = CASE WHEN "paymentMethod" = 'RAZORPAY' AND "paymentStatus" IN ('PAID', 'REFUNDED') THEN "totalAmount" ELSE 0 END
    WHERE "originalTotalAmount" IS NULL`);
  await exec(`
    UPDATE shipments sh SET "codAmount" = s."customerTotal"
    FROM sub_orders s JOIN orders o ON o.id = s."orderId"
    WHERE sh."subOrderId" = s.id AND o."paymentMethod" = 'COD' AND sh."codAmount" IS NULL`);

  // A prepaid part cancelled (or sent back) is refunded to the card in full.
  await exec(`
    UPDATE sub_orders s SET "cancelRefundAmountPaise" = round(s."customerTotal" * 100), "cancelRefundStatus" = 'COMPLETED',
      "cancelRazorpayRefundId" = 'rfnd_' || substr(replace(s.id::text, '-', ''), 1, 14), "cancelRefundAttemptCount" = 1,
      "cancelRefundLastAttemptAt" = s."updatedAt"
    FROM orders o
    WHERE o.id = s."orderId" AND s.status = 'CANCELLED' AND o."paymentMethod" = 'RAZORPAY'
      AND o."paymentStatus" IN ('PAID', 'REFUNDED') AND s."cancelRefundAmountPaise" IS NULL`);
  await exec(`
    UPDATE orders o SET "cancelRefundAmountPaise" = round(o."totalAmount" * 100)
    WHERE o.status = 'CANCELLED' AND o."cancelRefundStatus" = 'COMPLETED' AND o."cancelRefundAmountPaise" IS NULL
      AND NOT EXISTS (SELECT 1 FROM sub_orders s WHERE s."orderId" = o.id AND s."cancelRefundAmountPaise" IS NOT NULL)`);

  // Gift wrap is the platform's own supply, invoiced by the platform.
  const settings = await settingsService.getPlatformSettings();
  const wrapped = await select<{ id: string; fee: string; state: string }>(
    `SELECT o.id, o."giftWrapFeeAmount"::text AS fee, a.state FROM orders o JOIN addresses a ON a.id = o."shippingAddressId"
     WHERE o."giftWrap" = true AND o."platformInvoiceSnapshot" IS NULL`,
  );
  for (const order of wrapped) {
    const intraState = isIntraStateSupply(settings.platformState, order.state);
    const line = giftWrapInvoiceLine(Number(order.fee), intraState);
    await sequelize.query(`UPDATE orders SET "platformInvoiceSnapshot" = :snap WHERE id = :id`, {
      replacements: { id: order.id, snap: JSON.stringify({ invoiceNumber: null, issuedAt: null, intraState, lines: [line], totalPaise: platformInvoiceLineTotalPaise(line) }) },
    });
  }
}

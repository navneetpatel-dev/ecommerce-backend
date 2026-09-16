import { runPreconditions } from './scenarios/00-preconditions';
import { runCodFullReportSweep } from './scenarios/01-cod-full-report-sweep';
import { runOnlineCancelReversal } from './scenarios/02-online-cancel-reversal';
import { runWalletOnlyAndSplitCancel } from './scenarios/03-wallet-only-and-split-cancel';
import { runHybridWalletRazorpay } from './scenarios/04-hybrid-wallet-razorpay';
import { runMultiVendorIntraInterState } from './scenarios/05-multi-vendor-intra-inter-state';
import { runCouponDiscount } from './scenarios/06-coupon-discount';
import { printSummary } from './lib/assert';
import { closeOtpQueue } from './lib/otpFromQueue';

async function main() {
  console.log('E2E Calculation Verification — starting\n');

  console.log('--- 00: preconditions ---');
  const ctx = await runPreconditions();

  const scenarios: Array<[string, () => Promise<unknown>]> = [
    ['01', () => runCodFullReportSweep(ctx)],
    ['02', () => runOnlineCancelReversal(ctx)],
    ['03', () => runWalletOnlyAndSplitCancel(ctx)],
    ['04', () => runHybridWalletRazorpay(ctx)],
    ['05', () => runMultiVendorIntraInterState(ctx)],
    ['06', () => runCouponDiscount(ctx)],
  ];

  for (const [id, run] of scenarios) {
    try {
      await run();
    } catch (err) {
      console.error(`\n💥 Scenario ${id} threw an unhandled error:`, err);
    }
  }

  const failures = printSummary();
  await closeOtpQueue();
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL ERROR:', err);
  process.exit(1);
});

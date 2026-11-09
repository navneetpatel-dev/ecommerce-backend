/**
 * Payouts made by the payout run itself (`payoutsService.process`), replayed through the
 * history a few days at a time: each run pays every vendor for the sales released so far,
 * so each vendor gets a payout per window with the real breakdown, the 194-O TDS rows and
 * the commission invoice. The newest sales are left unpaid, as they would be today.
 * Payouts are then dated to their window and moved on (paid, a few failed, recent ones
 * still pending or processing).
 */
import { payoutsService } from '../../src/modules/payouts/payouts.service';
import { notificationsService } from '../../src/modules/notifications/notifications.service';
import { gstPeriodOf } from '../../src/modules/pricing/gstPeriod';
import { HISTORY_DAYS, NOW, PHOTO_URLS, addDays, chance, daysAgo, exec, pgArray, pick, select } from './lib';
import { SMALL } from './scale';
import type { Accounts } from './accounts';

/** Days per payout window: enough windows for 100+ payouts per vendor. */
const WINDOW_DAYS = SMALL ? 45 : 3.5;
/** Sales from the last few weeks are not paid yet. */
const UNPAID_DAYS = 21;

export async function seedPayouts(accounts: Accounts): Promise<void> {
  // A seed must not email hundreds of vendors: the payout run's notification is skipped.
  const notify = notificationsService.sendPayoutProcessed;
  notificationsService.sendPayoutProcessed = (async () => undefined) as unknown as typeof notify;
  const actor = accounts.superAdminId;

  // Hold every unpaid sale and release them window by window.
  await exec(`CREATE TEMP TABLE seed_held AS SELECT id, "createdAt" FROM commission_ledgers WHERE status = 'PENDING' AND "payoutId" IS NULL`);
  await exec(`UPDATE commission_ledgers SET status = 'SETTLED' WHERE id IN (SELECT id FROM seed_held)`);

  const end = daysAgo(UNPAID_DAYS);
  let windows = 0;
  for (let from = daysAgo(HISTORY_DAYS + 5); from < end; from = addDays(from, WINDOW_DAYS)) {
    const until = addDays(from, WINDOW_DAYS);
    await exec(
      `UPDATE commission_ledgers SET status = 'PENDING' WHERE id IN (SELECT id FROM seed_held WHERE "createdAt" < :until)`,
      { until },
    );
    await exec(`DELETE FROM seed_held WHERE "createdAt" < :until`, { until });
    const runAt = new Date();
    await payoutsService.process(actor);
    // Date what this run made to the end of its window, as if it ran then.
    const paidOn = addDays(until, 1);
    await exec(`UPDATE payouts SET "createdAt" = :at, "updatedAt" = :at, "preparedAt" = :at WHERE "createdAt" >= :runAt`, { at: paidOn, runAt });
    await exec(`UPDATE tds_ledgers SET "createdAt" = :at, "updatedAt" = :at, period = :period WHERE "createdAt" >= :runAt`, { at: paidOn, period: gstPeriodOf(paidOn), runAt });
    await exec(`UPDATE commission_invoices SET "issuedAt" = :at, "createdAt" = :at, "updatedAt" = :at WHERE "createdAt" >= :runAt`, { at: paidOn, runAt });
    windows += 1;
    if (windows % 20 === 0) console.log(`  ${windows} payout runs (to ${until.toISOString().slice(0, 10)})`);
  }
  // What was not released (the last weeks) is still owed.
  await exec(`UPDATE commission_ledgers SET status = 'PENDING' WHERE id IN (SELECT id FROM seed_held)`);
  await exec('DROP TABLE seed_held');
  notificationsService.sendPayoutProcessed = notify;

  // Move each payout on: older ones paid (a few failed), recent ones pending or processing.
  const payouts = await select<{ id: string; createdAt: Date }>(`SELECT id, "createdAt" FROM payouts WHERE status = 'PENDING' AND "paidAt" IS NULL`);
  const updates = payouts.map((payout) => {
    const ageDays = (NOW.getTime() - payout.createdAt.getTime()) / 86_400_000;
    const status = ageDays < 10 ? pick(['PENDING', 'PROCESSING']) : chance(0.03) ? 'FAILED' : 'PAID';
    return { ...payout, status };
  });
  for (const status of ['PAID', 'FAILED', 'PROCESSING'] as const) {
    const ids = updates.filter((row) => row.status === status).map((row) => row.id);
    for (let i = 0; i < ids.length; i += 1000) {
      const chunk = ids.slice(i, i + 1000);
      if (status === 'PAID') {
        await exec(
          `UPDATE payouts SET status = 'PAID', "paidAt" = "createdAt" + interval '2 days', "updatedAt" = "createdAt" + interval '2 days',
             "paymentMethod" = (ARRAY['NEFT','IMPS','UPI','RTGS'])[1 + mod(abs(hashtext(id::text)), 4)]::"enum_payouts_paymentMethod",
             "paymentReferenceNumber" = 'UTR' || upper(substr(replace(id::text, '-', ''), 1, 12)),
             "paidByAdminId" = :admin, "proofOfPaymentUrl" = (:photos::text[])[1 + mod(abs(hashtext(id::text)), :photoCount)],
             remarks = 'Settled to the registered bank account'
           WHERE id IN (:ids)`,
          { ids: chunk, admin: actor, photos: pgArray(PHOTO_URLS), photoCount: PHOTO_URLS.length },
        );
      } else if (status === 'FAILED') {
        await exec(`UPDATE payouts SET status = 'FAILED', "failureReason" = 'Beneficiary account inactive; vendor asked to update bank details', "updatedAt" = "createdAt" + interval '1 day' WHERE id IN (:ids)`, { ids: chunk });
      } else {
        await exec(`UPDATE payouts SET status = 'PROCESSING', "updatedAt" = "createdAt" + interval '1 day' WHERE id IN (:ids)`, { ids: chunk });
      }
    }
  }
  const [count] = await select<{ c: string }>('SELECT count(*)::text AS c FROM payouts');
  console.log(`  ${windows} payout runs, ${count!.c} payouts in all`);
}

import type { Transaction } from 'sequelize';
import { Op } from 'sequelize';
import { WalletLedger } from '@database/models/walletLedger.model';
import {
  WALLET_LEDGER_TYPE,
  WALLET_POINT_SOURCE,
  WALLET_REFERENCE_TYPE,
} from '@core/constants/statuses';
import { walletService } from './wallet.service';
import { WALLET_DESCRIPTIONS } from './wallet.constants';
import { fromPaise, toPaise } from '@modules/pricing/money';

const ROLLBACK_SUFFIX = ' rollback';

export function walletRollbackDescription(): string {
  return `${WALLET_DESCRIPTIONS.CHECKOUT_SPEND}${ROLLBACK_SUFFIX}`;
}

/** True when checkout wallet spend was already credited back for this order. */
export async function hasWalletRollbackCredit(
  orderId: string,
  transaction: Transaction,
): Promise<boolean> {
  const row = await WalletLedger.findOne({
    where: {
      referenceType: WALLET_REFERENCE_TYPE.ORDER,
      referenceId: orderId,
      type: WALLET_LEDGER_TYPE.CREDIT,
      description: { [Op.like]: `%${ROLLBACK_SUFFIX}` },
    },
    transaction,
  });
  return row != null;
}

async function findCheckoutDebit(
  orderId: string,
  transaction: Transaction,
): Promise<WalletLedger | null> {
  return WalletLedger.findOne({
    where: {
      referenceType: WALLET_REFERENCE_TYPE.ORDER,
      referenceId: orderId,
      type: WALLET_LEDGER_TYPE.DEBIT,
    },
    order: [['createdAt', 'DESC']],
    transaction,
  });
}

/**
 * Best-effort restoration of the original promotional lot's expiry, rather than always minting a
 * fresh full-TTL expiry on rollback (which would silently extend points that were about to
 * expire, every time they're spent-then-rolled-back via order cancellation). The ledger only
 * tracks aggregate purchased/promotional balances, not which specific credit row(s) a debit
 * actually drew from — so this approximates the codebase's documented FIFO policy (oldest
 * promotional credit spent first) by using the oldest promotional credit that existed at the
 * time of the debit being rolled back. Returns null (caller falls back to a fresh TTL) when no
 * such credit can be found, OR when that lot's expiry has already passed by now — restoring an
 * already-elapsed expiry would grant a credit the promo-expiry cron job immediately reclaims on
 * its next run, silently vanishing the "restored" points while `hasWalletRollbackCredit` already
 * marks the rollback done (unretriable). A fresh TTL is a known, accepted, minor windfall; a
 * grant-then-instant-reclaim is a confusing bug.
 */
async function resolveOriginalPromotionalExpiry(
  userId: string,
  debit: WalletLedger,
  transaction: Transaction,
): Promise<Date | null> {
  const oldestPromotionalCredit = await WalletLedger.findOne({
    where: {
      userId,
      type: WALLET_LEDGER_TYPE.CREDIT,
      pointSource: WALLET_POINT_SOURCE.PROMOTIONAL,
      createdAt: { [Op.lte]: debit.createdAt },
    },
    order: [['createdAt', 'ASC']],
    transaction,
  });
  const expiresAt = oldestPromotionalCredit?.expiresAt ?? null;
  if (!expiresAt || expiresAt.getTime() <= Date.now()) return null;
  return expiresAt;
}

const PART_RETURN_MARKER = ' returned for cancelled part ';

function partReturnDescription(subOrderId: string): string {
  return `${WALLET_DESCRIPTIONS.CHECKOUT_SPEND}${PART_RETURN_MARKER}${subOrderId}`;
}

/** What earlier part cancellations of this order already returned, by point source. */
async function returnedForCancelledParts(
  orderId: string,
  transaction: Transaction,
): Promise<{ promotional: number; purchased: number }> {
  const rows = await WalletLedger.findAll({
    where: {
      referenceType: WALLET_REFERENCE_TYPE.ORDER,
      referenceId: orderId,
      type: WALLET_LEDGER_TYPE.CREDIT,
      description: { [Op.like]: `%${PART_RETURN_MARKER}%` },
    },
    attributes: ['amount', 'pointSource'],
    transaction,
  });
  const sum = (source: string) =>
    fromPaise(
      rows
        .filter((row) => row.pointSource === source)
        .reduce((total, row) => total + toPaise(Number(row.amount)), 0),
    );
  return {
    promotional: sum(WALLET_POINT_SOURCE.PROMOTIONAL),
    purchased: sum(WALLET_POINT_SOURCE.PURCHASED),
  };
}

/**
 * Return the wallet share of one cancelled part (sub-order) of an order straight away,
 * in the same promotional / purchased mix as the checkout debit. Without it a partial
 * cancellation refunded only the cash part and the wallet part came back only if every
 * part was cancelled. `rollbackOrderWalletIfNeeded` later returns only what is left.
 * Idempotent per sub-order. Returns true when a credit was written.
 */
export async function returnWalletShareForCancelledPart(
  order: { id: string; walletAmountUsed?: number | null },
  subOrderId: string,
  sharePaise: number,
  userId: string,
  transaction: Transaction,
): Promise<boolean> {
  if (sharePaise <= 0 || Number(order.walletAmountUsed ?? 0) <= 0) return false;
  const description = partReturnDescription(subOrderId);
  const already = await WalletLedger.findOne({
    where: {
      referenceType: WALLET_REFERENCE_TYPE.ORDER,
      referenceId: order.id,
      type: WALLET_LEDGER_TYPE.CREDIT,
      description,
    },
    transaction,
  });
  if (already) return false;

  const ref = { type: WALLET_REFERENCE_TYPE.ORDER, id: order.id };
  const debit = await findCheckoutDebit(order.id, transaction);
  const promoPaise = toPaise(Number(debit?.pointSourceBreakdown?.promotional ?? 0));
  const purchasedPaise = toPaise(Number(debit?.pointSourceBreakdown?.purchased ?? 0));
  const splitTotal = promoPaise + purchasedPaise;
  // Same mix as the debit; no recorded mix is treated as promotional, like the full rollback.
  const promoShare = splitTotal > 0 ? Math.round((sharePaise * promoPaise) / splitTotal) : sharePaise;
  const purchasedShare = sharePaise - promoShare;
  const originalPromotionalExpiry = debit
    ? await resolveOriginalPromotionalExpiry(userId, debit, transaction)
    : null;

  if (promoShare > 0) {
    await walletService.credit(userId, fromPaise(promoShare), ref, description, transaction, {
      pointSource: WALLET_POINT_SOURCE.PROMOTIONAL,
      ...(originalPromotionalExpiry ? { expiresAt: originalPromotionalExpiry } : {}),
    });
  }
  if (purchasedShare > 0) {
    await walletService.credit(userId, fromPaise(purchasedShare), ref, description, transaction, {
      pointSource: WALLET_POINT_SOURCE.PURCHASED,
    });
  }
  return true;
}

/**
 * Idempotently restore wallet points debited at checkout for a cancelled order.
 * Restores purchased vs promotional split when the original debit recorded it, less what
 * earlier part cancellations already returned.
 * Returns true when a new credit was written.
 */
export async function rollbackOrderWalletIfNeeded(
  order: { id: string; walletAmountUsed?: number | null },
  userId: string,
  transaction: Transaction,
): Promise<boolean> {
  const walletUsed = Number(order.walletAmountUsed ?? 0);
  if (walletUsed <= 0) return false;
  if (await hasWalletRollbackCredit(order.id, transaction)) return false;

  const ref = { type: WALLET_REFERENCE_TYPE.ORDER, id: order.id };
  const description = walletRollbackDescription();
  const debit = await findCheckoutDebit(order.id, transaction);
  const breakdown = debit?.pointSourceBreakdown;
  const returned = await returnedForCancelledParts(order.id, transaction);
  const promoAmount = Math.max(
    0,
    fromPaise(toPaise(Number(breakdown?.promotional ?? 0)) - toPaise(returned.promotional)),
  );
  const purchasedAmount = Math.max(
    0,
    fromPaise(toPaise(Number(breakdown?.purchased ?? 0)) - toPaise(returned.purchased)),
  );
  const hasBreakdown =
    Number(breakdown?.promotional ?? 0) > 0 || Number(breakdown?.purchased ?? 0) > 0;
  const originalPromotionalExpiry = debit
    ? await resolveOriginalPromotionalExpiry(userId, debit, transaction)
    : null;

  if (hasBreakdown) {
    if (promoAmount > 0) {
      await walletService.credit(
        userId,
        promoAmount,
        ref,
        description,
        transaction,
        {
          pointSource: WALLET_POINT_SOURCE.PROMOTIONAL,
          ...(originalPromotionalExpiry ? { expiresAt: originalPromotionalExpiry } : {}),
        },
      );
    }
    if (purchasedAmount > 0) {
      await walletService.credit(
        userId,
        purchasedAmount,
        ref,
        description,
        transaction,
        { pointSource: WALLET_POINT_SOURCE.PURCHASED },
      );
    }
    return promoAmount > 0 || purchasedAmount > 0;
  }

  const remaining = fromPaise(
    toPaise(walletUsed) - toPaise(returned.promotional) - toPaise(returned.purchased),
  );
  if (remaining <= 0) return false;
  await walletService.credit(
    userId,
    remaining,
    ref,
    description,
    transaction,
    {
      pointSource: WALLET_POINT_SOURCE.PROMOTIONAL,
      ...(originalPromotionalExpiry ? { expiresAt: originalPromotionalExpiry } : {}),
    },
  );
  return true;
}

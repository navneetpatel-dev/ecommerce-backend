/**
 * Wallets, gift cards and cashback, replayed per customer in date order so every
 * running balance is right:
 *  - gift cards: each customer sends GIFT_CARDS_PER_CUSTOMER (every status) and redeems
 *    100+ sent by others into their wallet;
 *  - cashback on every paid order (a CASHBACK coupon and/or the best platform offer live
 *    then), credited after delivery, clawed back when a return is refunded (written off
 *    when the wallet cannot cover it);
 *  - top-ups (with their receipts), wallet spends on orders, refunds to the wallet,
 *    promotional expiry and admin adjustments.
 */
import { WALLET_DESCRIPTIONS } from '../../src/modules/wallet/wallet.constants';
import { NOW, addDays, addHours, between, chance, exec, id, insert, int, json, minDate, pick, select, weighted } from './lib';
import { scaled } from './scale';
import type { Accounts } from './accounts';

export const GIFT_CARDS_PER_CUSTOMER = scaled(140, 4);
const RECHARGES_PER_CUSTOMER = scaled(8, 2);

type OrderRow = {
  id: string; userId: string; createdAt: Date; status: string; paymentStatus: string; method: string; total: string;
  bearer: string | null; couponType: string | null; couponValue: string | null; couponCap: string | null; deliveredAt: Date | null;
};
type Offer = { id: string; percent: string; maxCashback: string | null; minOrderValue: string; paymentMethods: string[]; startsAt: Date; endsAt: Date | null; isActive: boolean; scoped: boolean };
type Event = {
  at: Date; kind: 'CREDIT' | 'DEBIT'; amount: number; ref: string; refId: string; description: string;
  source: 'PURCHASED' | 'PROMOTIONAL'; expires?: Date | null; spendOrder?: OrderRow; clawback?: { orderId: string; returnId: string; amount: number; bearer: string };
};

const paise = (rupees: string | number | null) => Math.round(Number(rupees ?? 0) * 100);

/** The cashback an order earned at checkout, in paise: its CASHBACK coupon and the best offer. */
function cashbackFor(order: OrderRow, offers: Offer[]): { amount: number; offerId: string | null } {
  const total = paise(order.total);
  let coupon = 0;
  if (order.couponType === 'CASHBACK') coupon = Math.min(Math.floor((total * Number(order.couponValue)) / 100), paise(order.couponCap ?? 1e9));
  if (order.bearer === 'VENDOR') return { amount: coupon, offerId: null };
  let best = { amount: 0, offerId: null as string | null };
  for (const offer of offers) {
    const live = offer.isActive && offer.startsAt <= order.createdAt && (!offer.endsAt || offer.endsAt > order.createdAt);
    if (!live || offer.scoped || total < paise(offer.minOrderValue)) continue;
    if (offer.paymentMethods.length && !offer.paymentMethods.includes(order.method)) continue;
    const amount = Math.min(Math.floor((total * Math.round(Number(offer.percent) * 100)) / 10_000), offer.maxCashback ? paise(offer.maxCashback) : Infinity);
    if (amount > best.amount) best = { amount, offerId: offer.id };
  }
  return { amount: coupon + best.amount, offerId: best.offerId };
}

const giftCode = () => Array.from({ length: 12 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[int(0, 31)]).join('');

async function seedGiftCards(accounts: Accounts): Promise<Event[][]> {
  const customers = accounts.customers;
  const credits = new Map<string, Event[]>();
  const cards: Array<Record<string, unknown>> = [];
  let redeemerCursor = 0;
  for (const [index, buyer] of customers.entries()) {
    for (let n = 0; n < GIFT_CARDS_PER_CUSTOMER; n += 1) {
      const createdAt = between(addDays(buyer.createdAt, 1), addDays(NOW, -1));
      const status = weighted([['REDEEMED', 76], ['ACTIVE', 8], ['EXPIRED', 6], ['CANCELLED', 4], ['PENDING', 3], ['FAILED', 3]] as const);
      const amount = pick([250, 500, 750, 1000, 1500, 2000]);
      const paid = status !== 'PENDING' && status !== 'FAILED';
      const paidAt = paid ? addHours(createdAt, 1) : null;
      // EXPIRED cards are a year old; the rest expire a year after they were bought.
      const issued = status === 'EXPIRED' ? addDays(NOW, -int(370, 500)) : createdAt;
      let redeemer = customers[redeemerCursor++ % customers.length]!;
      if (redeemer.id === buyer.id) redeemer = customers[(index + 1) % customers.length]!;
      const redeemedAt = status === 'REDEEMED' ? minDate(between(addDays(createdAt, 1), addDays(createdAt, 60)), NOW) : null;
      const cardId = id();
      const code = giftCode();
      cards.push({
        id: cardId, code, amount, purchaserId: buyer.id, recipientEmail: status === 'REDEEMED' ? redeemer.email : `friend${n}.${index}@example.com`,
        recipientName: status === 'REDEEMED' ? redeemer.name : pick(['Aunt Meera', 'Rohan', 'Team Lead', 'Best friend']),
        message: chance(0.7) ? pick(['Happy birthday! 🎉', 'Congratulations!', 'Thank you for everything.', 'Happy Diwali!']) : null,
        redeemedByUserId: status === 'REDEEMED' ? redeemer.id : null, redeemedAt,
        expiresAt: addDays(issued, 365), status, paidAt: paid ? (status === 'EXPIRED' ? issued : paidAt) : null,
        razorpayOrderId: `order_gc${cardId.replace(/-/g, '').slice(0, 12)}`, razorpayPaymentId: paid ? `pay_gc${cardId.replace(/-/g, '').slice(12, 24)}` : null,
        createdAt: status === 'EXPIRED' ? issued : createdAt, updatedAt: redeemedAt ?? createdAt,
      });
      if (redeemedAt) {
        credits.set(redeemer.id, [...(credits.get(redeemer.id) ?? []), {
          at: redeemedAt, kind: 'CREDIT', amount: amount * 100, ref: 'GIFT_CARD', refId: cardId,
          description: `${WALLET_DESCRIPTIONS.GIFT_CARD_REDEMPTION} #${code}`, source: 'PURCHASED',
        }]);
      }
    }
  }
  await insert('gift_cards', cards);
  return customers.map((customer) => credits.get(customer.id) ?? []);
}

export async function seedWallets(accounts: Accounts): Promise<void> {
  const giftCredits = await seedGiftCards(accounts);
  const offers = (await select<Offer & { categoryIds: string[] }>(
    `SELECT id, percent::text, "maxCashback"::text, "minOrderValue"::text, "paymentMethods", "startsAt", "endsAt", "isActive", "categoryIds" FROM cashback_offers`,
  )).map((offer) => ({ ...offer, scoped: offer.categoryIds.length > 0 }));
  const orders = await select<OrderRow>(`
    SELECT o.id, o."userId", o."createdAt", o.status::text, o."paymentStatus"::text, o."paymentMethod"::text AS method, o."totalAmount"::text AS total,
      o."cashbackDiscountBearer"::text AS bearer, c.type::text AS "couponType", c.value::text AS "couponValue", c."maxDiscountCap"::text AS "couponCap",
      (SELECT max(sh."deliveredAt") FROM sub_orders s JOIN shipments sh ON sh."subOrderId" = s.id WHERE s."orderId" = o.id) AS "deliveredAt"
    FROM orders o LEFT JOIN coupons c ON c.id = o."couponId"
    WHERE o."paymentMethod" IS NOT NULL ORDER BY o."createdAt"`);
  const ordersByUser = new Map<string, OrderRow[]>();
  for (const order of orders) ordersByUser.set(order.userId, [...(ordersByUser.get(order.userId) ?? []), order]);
  const refunds = await select<{ id: string; userId: string; orderId: string; method: string; at: Date; wallet: string; refund: string }>(`
    SELECT r.id, r."userId", s."orderId", o."paymentMethod"::text AS method, r."resolvedAt" AS at, r."walletRefundAmount"::text AS wallet, r."refundAmount"::text AS refund
    FROM return_requests r JOIN sub_orders s ON s.id = r."subOrderId" JOIN orders o ON o.id = s."orderId"
    WHERE r."refundStatus" = 'COMPLETED' AND r."resolvedAt" IS NOT NULL`);
  const refundsByUser = new Map<string, typeof refunds>();
  for (const row of refunds) refundsByUser.set(row.userId, [...(refundsByUser.get(row.userId) ?? []), row]);

  const ledger: Array<Record<string, unknown>> = [];
  const recharges: Array<Record<string, unknown>> = [];
  const writeOffs: Array<Record<string, unknown>> = [];
  const orderUpdates: Array<[string, number, string | null, string | null, number]> = [];

  for (const [index, customer] of accounts.customers.entries()) {
    const events: Event[] = [...giftCredits[index]!];
    const cashbackByOrder = new Map<string, { amount: number; credited: Date | null }>();
    for (const order of ordersByUser.get(customer.id) ?? []) {
      if (order.paymentStatus === 'PENDING' && order.method === 'RAZORPAY') continue;
      const { amount, offerId } = cashbackFor(order, offers);
      const delivered = order.status === 'DELIVERED' && order.deliveredAt ? addDays(order.deliveredAt, 1) : null;
      const credited = delivered && delivered < NOW ? delivered : null;
      orderUpdates.push([order.id, amount / 100, offerId, credited ? credited.toISOString() : null, 0]);
      if (amount > 0) cashbackByOrder.set(order.id, { amount, credited });
      if (credited && amount > 0) {
        events.push({ at: credited, kind: 'CREDIT', amount, ref: 'CASHBACK', refId: order.id, description: `${WALLET_DESCRIPTIONS.CASHBACK_CREDIT} #${order.id.slice(0, 8)}`, source: 'PROMOTIONAL', expires: addDays(credited, 180) });
      }
      if (order.method === 'RAZORPAY' && order.paymentStatus === 'PAID' && order.status !== 'CANCELLED' && chance(0.55)) {
        events.push({ at: addHours(order.createdAt, -0.01), kind: 'DEBIT', amount: 0, ref: 'ORDER', refId: order.id, description: `${WALLET_DESCRIPTIONS.CHECKOUT_SPEND} #${order.id.slice(0, 8)}`, source: 'PURCHASED', spendOrder: order });
      }
    }
    for (const refund of refundsByUser.get(customer.id) ?? []) {
      if (Number(refund.wallet) > 0) {
        const cod = refund.method === 'COD';
        events.push({ at: refund.at, kind: 'CREDIT', amount: paise(refund.wallet), ref: cod ? 'COD_REFUND' : 'RETURN', refId: refund.id, description: cod ? WALLET_DESCRIPTIONS.COD_REFUND : WALLET_DESCRIPTIONS.WALLET_PORTION_REFUND, source: 'PURCHASED' });
      }
      const cashback = cashbackByOrder.get(refund.orderId);
      const order = (ordersByUser.get(customer.id) ?? []).find((row) => row.id === refund.orderId);
      if (cashback?.credited && order && cashback.credited < refund.at) {
        const amount = Math.min(cashback.amount, Math.round((cashback.amount * paise(refund.refund)) / Math.max(1, paise(order.total))));
        if (amount > 0) events.push({ at: refund.at, kind: 'DEBIT', amount, ref: 'CLAWBACK', refId: refund.id, description: WALLET_DESCRIPTIONS.CASHBACK_CLAWBACK, source: 'PROMOTIONAL', clawback: { orderId: order.id, returnId: refund.id, amount, bearer: order.bearer ?? 'PLATFORM' } });
      }
    }
    for (let r = 0; r < RECHARGES_PER_CUSTOMER; r += 1) {
      const at = between(customer.createdAt, addDays(NOW, -1));
      const amount = pick([500, 1000, 2000, 3000, 5000]);
      const rechargeId = id();
      const status = r < RECHARGES_PER_CUSTOMER - 2 ? 'PAID' : pick(['FAILED', 'EXPIRED', 'PENDING']);
      const ledgerId = status === 'PAID' ? id() : null;
      recharges.push({
        id: rechargeId, userId: customer.id, amountInr: amount, pointsCredited: status === 'PAID' ? amount : 0, pointsPerRupee: 1,
        razorpayOrderId: `order_wr${rechargeId.replace(/-/g, '').slice(0, 12)}`, razorpayPaymentId: status === 'PAID' ? `pay_wr${rechargeId.replace(/-/g, '').slice(12, 24)}` : null,
        status, idempotencyKey: rechargeId, creditedLedgerId: ledgerId, paidAt: status === 'PAID' ? at : null, refundStatus: 'NONE',
        invoiceNumber: status === 'PAID' ? `WRC-${at.toISOString().slice(0, 10).replace(/-/g, '')}-${int(100000, 999999)}` : null,
        invoiceGeneratedAt: status === 'PAID' ? at : null, createdAt: at, updatedAt: at,
      });
      if (ledgerId) events.push({ at, kind: 'CREDIT', amount: amount * 100, ref: 'TOPUP', refId: rechargeId, description: WALLET_DESCRIPTIONS.TOPUP_CREDIT, source: 'PURCHASED', expires: null, ...{ ledgerId } });
    }
    events.push({ at: between(customer.createdAt, NOW), kind: 'CREDIT', amount: int(1, 5) * 10_000, ref: 'ADMIN_ADJUSTMENT', refId: customer.id, description: `${WALLET_DESCRIPTIONS.ADMIN_ADJUSTMENT}: goodwill for a delayed delivery`, source: 'PROMOTIONAL' });
    for (let q = 0; q < 4; q += 1) events.push({ at: addDays(customer.createdAt, 120 * (q + 1)), kind: 'DEBIT', amount: -1, ref: 'EXPIRY', refId: customer.id, description: WALLET_DESCRIPTIONS.PROMO_EXPIRY, source: 'PROMOTIONAL' });

    // Replay in date order: balances, promotional-first spending, and what each event moved.
    events.sort((a, b) => a.at.getTime() - b.at.getTime());
    let purchased = 0;
    let promotional = 0;
    let last = 0;
    for (const event of events) {
      if (event.at > NOW) continue;
      let at = event.at.getTime();
      if (at <= last) at = last + 1;
      last = at;
      let amount = event.amount;
      let breakdown: { promotional: number; purchased: number } | null = null;
      if (event.kind === 'DEBIT') {
        const balance = purchased + promotional;
        if (event.ref === 'EXPIRY') amount = Math.floor(promotional * 0.3);
        if (event.spendOrder) amount = Math.min(balance, paise(event.spendOrder.total));
        if (event.clawback) amount = Math.min(balance, event.clawback.amount);
        if (event.clawback && amount < event.clawback.amount) {
          writeOffs.push({ id: id(), userId: customer.id, originalClawbackAmount: event.clawback.amount / 100, recoveredAmount: amount / 100, writtenOffAmount: (event.clawback.amount - amount) / 100, referenceType: 'RETURN', referenceId: event.clawback.returnId, bornBy: event.clawback.bearer === 'VENDOR' ? 'VENDOR' : 'PLATFORM', createdAt: new Date(at), updatedAt: new Date(at) });
        }
        if (amount <= 0 || (event.spendOrder && amount < 10_000)) continue;
        const fromPromo = event.ref === 'EXPIRY' ? amount : Math.min(promotional, amount);
        breakdown = { promotional: fromPromo / 100, purchased: (amount - fromPromo) / 100 };
        promotional -= fromPromo;
        purchased -= amount - fromPromo;
        if (event.spendOrder) orderUpdates.push([event.spendOrder.id, -1, null, null, amount / 100]);
      } else if (event.source === 'PROMOTIONAL') promotional += amount;
      else purchased += amount;
      ledger.push({
        id: (event as Event & { ledgerId?: string }).ledgerId ?? id(), userId: customer.id, type: event.kind, amount: amount / 100,
        balanceAfter: (purchased + promotional) / 100, referenceType: event.ref, referenceId: event.refId, description: event.description,
        pointSource: event.kind === 'CREDIT' ? event.source : null, expiresAt: event.kind === 'CREDIT' ? (event.expires ?? null) : null,
        pointSourceBreakdown: breakdown ? json(breakdown) : null, createdAt: new Date(at), updatedAt: new Date(at),
      });
    }
  }
  await insert('wallet_recharge_orders', recharges);
  await insert('wallet_ledgers', ledger);
  await insert('wallet_write_offs', writeOffs);
  console.log(`  ${ledger.length} wallet entries, ${recharges.length} top-ups, ${writeOffs.length} write-offs`);

  // Cashback on the orders, then what the wallet paid for them.
  await exec('CREATE TEMP TABLE seed_order_money (id uuid, cashback numeric, offer uuid, credited timestamptz, wallet numeric)');
  for (let i = 0; i < orderUpdates.length; i += 1000) {
    const chunk = orderUpdates.slice(i, i + 1000);
    await exec(
      `INSERT INTO seed_order_money VALUES ${chunk.map((_, n) => `(:id${n}, :c${n}, :o${n}, :t${n}, :w${n})`).join(', ')}`,
      Object.fromEntries(chunk.flatMap(([orderId, cashback, offer, credited, wallet], n) => [[`id${n}`, orderId], [`c${n}`, cashback], [`o${n}`, offer], [`t${n}`, credited], [`w${n}`, wallet]])),
    );
  }
  await exec(`
    UPDATE orders o SET "pendingCashbackAmount" = m.cashback, "cashbackOfferId" = m.offer, "cashbackCreditedAt" = m.credited
    FROM seed_order_money m WHERE m.id = o.id AND m.cashback >= 0`);
  await exec(`
    UPDATE orders o SET "walletAmountUsed" = m.wallet, "razorpayAmountPaid" = GREATEST(0, o."totalAmount" - m.wallet)
    FROM seed_order_money m WHERE m.id = o.id AND m.wallet > 0`);
  await exec('DROP TABLE seed_order_money');
}

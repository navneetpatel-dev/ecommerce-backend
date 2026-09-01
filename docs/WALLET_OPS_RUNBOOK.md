# Wallet Operations Runbook

Support and admin playbook for wallet points, recharge, and refund edge cases.

## Local development / integration tests

Wallet integration tests (`refund.scenarios.integration.test.ts`, etc.) require Postgres with migrations applied:

```bash
cd backend && npm run db:migrate
```

Migration `20240101000105-wallet-gap-closure.js` adds `cancelRefundStatus`, `expiresAt`, and `pointSourceBreakdown` columns.

## Recharge paid but points not credited (max balance)

**Symptoms:** Razorpay payment succeeded; `wallet_recharge_orders.status = FAILED`; customer sees no points.

**Cause:** Balance would exceed `walletMaxBalancePoints` at credit time.

**Automated handling:** System initiates Razorpay refund with `notes.rechargeId`. Customer receives `WALLET_RECHARGE_FAILED` email. Invoice is not generated until status is `PAID`.

**Manual steps:**
1. Admin → Finance → Wallet Recharge report: find row by `razorpayPaymentId`.
2. Confirm `refundStatus` is `INITIATED` or `COMPLETED`.
3. If refund stuck in `FAILED`, retry from Razorpay dashboard or use admin adjust (below).

## Razorpay refund failed on return approve

**Symptoms:** Return `refundStatus = FAILED`; wallet portion may already be credited.

**Automated handling:** Hourly `refund-retry` job calls `retryRazorpayRefund`.

**Manual steps:**
1. Admin → Returns → open return → **Retry refund** (`POST /api/returns/:id/retry-refund`).
2. Check `refundAttemptCount` and `refundFailureReason` on the return row.
3. If Razorpay shows refund already created, wait for `refund.processed` webhook.

## Orphan PENDING recharges

**Symptoms:** Customer dismissed Razorpay modal; row stays `PENDING`.

**Automated handling:** Hourly `wallet-recharge-expiry` job marks rows older than `WALLET_RECHARGE_PENDING_TTL_HOURS` (default 24) as `EXPIRED`. Customer may retry with the same idempotency key.

## Promotional points expiry

**Symptoms:** Customer balance drops without a purchase; ledger shows `Promotional points expired`.

**Automated handling:** Daily `promo-points-expiry` job debits only **expired promotional lots** (`min(expiredLots, netPromo)`), never purchased points.

**Manual steps:**
1. Check `wallet_ledgers.expiresAt` on promotional credits.
2. Confirm `promotionalPointsTtlDays` in platform settings (0 = disabled).

## Manual wallet adjustment

**Permission:** `wallet.adjust` (Admin Order Manager, Super Admin).

**UI:** Admin → Finance → Reports → **Manual wallet adjustment** panel.

**API:** `POST /api/admin/wallet/:userId/adjust`

```json
{
  "direction": "CREDIT",
  "amount": 500,
  "reason": "Goodwill credit for failed recharge",
  "pointSource": "PROMOTIONAL"
}
```

## Recharge GST invoice

**Customer:** Wallet → transaction history → **Download invoice** on paid recharge rows.

**API:** `GET /api/wallet/recharge/:id/invoice` (PDF). Generated on first download or automatically after `PAID`.

**Note:** Prepaid store-credit invoice — not a merchandise GST invoice.

## Webhook refund mismatch

When multiple returns on one order share the same Razorpay refund amount, webhook matching without `returnRequestId` is **ambiguous** and logged for manual review.

**Manual steps:**
1. Find log: `Ambiguous refund webhook match`.
2. Complete the correct return via admin or retry with explicit `returnRequestId` in Razorpay notes.
3. Prefer `returnRequestId` in refund notes for all new refunds.

## Wallet liability reports

Admin → Finance → Reports → **Wallet liability** uses FIFO (promotional-first) ledger breakdown, not proportional estimates. Purchased vs promotional columns should match `/api/wallet/balance` sub-balances.

## Paid order cancel

**Customer:** Order detail → **Cancel order** while all seller slices are pending/confirmed.

**Effects:** Wallet points restored immediately (original purchased/promotional split when recorded). Razorpay portion refunds via webhook; track `cancelRefundStatus` on the order.

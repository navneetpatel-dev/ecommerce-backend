# E2E Calculation Verification

Drives the real running backend over HTTP as every relevant role (customer, vendor, admin,
delivery agent) to prove — not just read the code and assume — that every calculation (GST
CGST/SGST/IGST, commission, TCS, wallet debit/rollback split, coupon discount, cancellation
reversal, delivery-agent earnings) is correct end-to-end, across every payment method (COD,
wallet-only, hybrid wallet+Razorpay) and reconciles across every report/role that surfaces it.

## Prerequisites

```bash
docker ps --filter name=ecommerce-postgres --filter name=ecommerce-redis   # both healthy
cd backend && npm run dev                                                  # server on :9000
curl -sf http://localhost:9000/health                                      # 200 before running
```

## Run

```bash
cd backend
npx tsx scripts/e2e-calc-verification/runAll.ts
```

Prints a ✅/❌ line per check and a final pass/fail summary; exits 1 if anything failed.

## What it covers

| Scenario | Payment method | What it proves |
|---|---|---|
| 01 | COD | Full order → all 4 roles' reports → delivery-agent OTP → COD settlement → agent earnings |
| 02 | Razorpay (online) | Cancel a **paid** order: real refund-initiation call, commission/TCS ledger reversal, report drop-out |
| 03 | Wallet-only | Wallet debit split (promotional-first), then cancel: exact split-preserving rollback |
| 04 | Hybrid (wallet + Razorpay) | Partial wallet + gateway remainder, payment-gateway-reconciliation |
| 05 | COD, multi-vendor | Same order: intra-state (CGST/SGST) + inter-state (IGST) legs, no cross-vendor leakage |
| 06 | COD + coupon | Platform-borne discount doesn't reduce vendor commission base; cap enforcement |

Every scenario independently recomputes expected tax/commission/TCS in plain JS
(`lib/pricingRecompute.ts`, a from-scratch reimplementation of `pricing.engine.ts`'s formulas)
and compares against what the live API actually returns — it does not just check the API is
internally self-consistent.

## Design notes

- **No teardown.** This runs against the shared seeded dev DB, which already carries ~200
  fixture orders nobody cleans up. Every scenario is idempotent by construction — it clears
  the customer's cart first, discovers all IDs live (never hardcodes a UUID that could go
  stale), and computes wallet-balance assertions as deltas against a captured baseline rather
  than fixed absolutes — so re-running this script repeatedly is safe and expected.
- **Payment simulation.** Razorpay payments are simulated via self-signed `payment.captured` /
  `refund.processed` webhooks (using `RAZORPAY_WEBHOOK_SECRET` from `.env`) — the only code path
  that actually marks an order paid. The real `razorpay.orders.create()` call in the hybrid/
  online scenarios does hit Razorpay's real test-mode API; the real `razorpay.payments.refund()`
  call in scenario 02 is *expected* to fail (`cancelRefundStatus: FAILED`) since the captured
  payment id is synthetic and has no real Razorpay-side counterpart — the DB-side reversal
  (commission/TCS ledger deletion, restock, wallet rollback) is what's actually verified there.
- **Delivery OTP** is read from the real BullMQ `email-transactional` queue
  (`lib/otpFromQueue.ts`) rather than bypassed — the OTP-issuing code path really runs; only the
  *email send* fails in dev (no real SMTP creds), which doesn't prevent reading the code off the
  job payload.
- **Shipping data gap (unrelated to calculations):** several vendor/pincode combinations return
  "No shipping rate is available" (a real seed-data completeness gap in `shipping_rates`, not a
  calculation bug) — scenario 05 deliberately routes around this using vendor/pincode pairs
  confirmed to have configured rates (HomeStyle↔Delhi intra-state, TechWorld↔Delhi inter-state).

## Bug found and fixed while building this

`deliveryAgents.repository.ts`'s `assignedShipment()`/`assignedPickup()` combined
`lock: transaction.LOCK.UPDATE` with a multi-level `include` (implicit `LEFT OUTER JOIN`s) —
Postgres rejects `FOR UPDATE` across the nullable side of an outer join. This broke **every**
delivery-status transition (`OUT_FOR_DELIVERY`, `PICKED_UP`, `FAILED`, pickup confirmations),
not just the one this script happened to exercise first. Fixed by acquiring the row lock via a
separate, include-free query before the hydrated (unlocked) read — see the code comments at
each call site for the full explanation.

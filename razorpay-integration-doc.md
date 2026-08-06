# Razorpay Integration — Backend-Authoritative, No Frontend Trust

**Core rule, stated once, applies everywhere below:** the frontend never decides an amount, never creates a Razorpay order directly, and its "verify" call is a UX confirmation only — the **webhook** is the actual source of truth. Everything money-related is computed and confirmed server-side against your own database, never accepted from the client.

This doc reconciles a generic integration checklist against your **already-established** backend (Sequelize + TS, `core/` error handling, checkout service) and frontend (Next.js). It does not introduce new endpoint names, new tables, or a new pattern — it uses what backend Section 14 and frontend Section 8.6 already specified, and fills the one real gap the generic version had: **it never mentioned the webhook as authoritative**, which is the actual mechanism that prevents frontend manipulation. A client-side "verify" call alone can be skipped, replayed, or spoofed by anyone who can read your frontend JS — it's fine as instant UX feedback, but it must never be what actually marks an order paid.

---

## 1. What the Backend Owns (Everything That Matters)

| Concern | Rule |
|---|---|
| **Amount** | Computed server-side from the cart/order already in your DB (`Order.totalAmount`, per backend Section 4.4) at the moment of order creation. Never accept an `amount` field from the frontend request body — if one arrives, ignore it. |
| **Order creation** | `POST /api/checkout` (already speced, backend Section 14.1/14.5) — creates your own `Order` row first, then calls Razorpay's Orders API with the amount pulled from that row, stores `razorpayOrderId` on it (column already exists per backend Section 4.4's `Order` model). |
| **Signature verification (client callback)** | `POST /api/checkout/verify` (already speced) — HMAC-SHA256 check, UX confirmation only. Marks nothing as paid on its own. |
| **Authoritative confirmation** | `POST /api/webhooks/razorpay` (already speced, backend Section 14.2–14.3) — signature-verified, idempotent (via the `WebhookEvent` dedup table), and this is the **only** place `Order.paymentStatus` actually flips to `PAID`. |
| **Vendor payouts** | Razorpay Route, triggered off the same webhook-confirmed state (backend Section 14.4) — not touched by this doc's scope, just noting it depends on the webhook being correct. |

## 2. Backend Implementation

Use the official `razorpay` npm SDK (not raw `fetch` calls to Razorpay's REST API) — it matches your existing service-layer pattern better and handles request signing/retries for you.

```bash
npm install razorpay
```

```ts
// src/config/razorpay.ts
import Razorpay from 'razorpay';

export const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID!,
  key_secret: process.env.RAZORPAY_KEY_SECRET!,
});
```

```ts
// src/modules/payments/payments.service.ts
import { razorpay } from '@config/razorpay';
import { Order } from '@database/models/order.model';
import { ValidationError } from '@core/errors/ValidationError';

export async function createRazorpayOrderForOrder(order: Order) {
  // amount comes from the Order row already computed server-side — never from the request
  const amountInPaise = Math.round(Number(order.totalAmount) * 100);
  if (amountInPaise < 100) throw new ValidationError('Order amount below Razorpay minimum');

  const rzpOrder = await razorpay.orders.create({
    amount: amountInPaise,
    currency: 'INR',
    receipt: order.id,
  });

  await order.update({ razorpayOrderId: rzpOrder.id });

  // return ONLY what the frontend needs to open the checkout modal — never the secret
  return { razorpayOrderId: rzpOrder.id, amount: rzpOrder.amount, currency: rzpOrder.currency, keyId: process.env.RAZORPAY_KEY_ID };
}
```

```ts
// src/modules/payments/payments.controller.ts — checkout/verify (UX confirmation, not authoritative)
import crypto from 'crypto';

export const verifyPayment = asyncHandler(async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    throw new ValidationError('Missing verification fields');
  }

  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET!)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');

  const isValid = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(razorpay_signature));
  if (!isValid) return res.status(400).json({ success: false, error: { code: 'INVALID_SIGNATURE', message: 'Signature mismatch' } });

  // Do NOT mark the order paid here. This just lets the frontend show a fast confirmation.
  // The webhook (below) is what actually flips paymentStatus.
  res.json(ok({ verified: true }));
});
```

```ts
// src/modules/payments/razorpay.webhook.ts — THE authoritative confirmation (backend Section 14.2–14.3)
export const handleRazorpayWebhook = asyncHandler(async (req, res) => {
  const signature = req.headers['x-razorpay-signature'] as string;
  const expected = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET!).update(req.rawBody).digest('hex');
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) {
    return res.status(400).json({ error: 'Invalid signature' });
  }

  const event = JSON.parse(req.rawBody);
  const [, created] = await WebhookEvent.findOrCreate({ where: { provider: 'razorpay', eventId: event.id }, defaults: { payload: event } });
  if (!created) return res.status(200).json({ received: true }); // already processed — idempotent

  if (event.event === 'payment.captured') {
    const payment = event.payload.payment.entity;
    await Order.update(
      { paymentStatus: 'PAID', razorpayPaymentId: payment.id },
      { where: { razorpayOrderId: payment.order_id } }
    );
    // fire ORDER_CONFIRMATION notification (backend Section 8) here
  }

  res.status(200).json({ received: true });
});
```

> **Mount `/api/webhooks/razorpay` with `express.raw({ type: 'application/json' })` before your global `express.json()` middleware** — signature verification needs the exact raw bytes Razorpay sent, not the parsed object (backend Section 14.2's note, restated because it's the single most common way this integration silently breaks).

## 3. What the Frontend Is Allowed to Do (and Nothing More)

The frontend's entire job: ask the backend to start a payment, open Razorpay's modal with what the backend returned, and forward the three callback fields back. It never computes an amount, never talks to Razorpay's API directly, never sees `RAZORPAY_KEY_SECRET`.

```ts
// src/features/checkout/checkout.api.ts
export const checkoutApi = {
  createOrder: () => apiClient.post<{ razorpayOrderId: string; amount: number; currency: string; keyId: string }>('/api/checkout'),
  verify: (payload: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) =>
    apiClient.post('/api/checkout/verify', payload),
};
```

```ts
// src/features/checkout/components/PaymentStep.tsx — event handling only, no amount, no secret
const handlePay = async () => {
  const { razorpayOrderId, amount, currency, keyId } = await checkoutApi.createOrder();

  const rzp = new window.Razorpay({
    key: keyId,               // public key only
    order_id: razorpayOrderId, // amount is implied by the order Razorpay already knows about — never passed again here
    amount, currency,
    handler: async (response) => {
      await checkoutApi.verify(response); // UX confirmation — see Section 1
      router.push(`/orders/${orderId}/confirmation`); // final state is confirmed by webhook, not this call
    },
    modal: { ondismiss: () => setPaymentState('cancelled') },
  });

  rzp.on('payment.failed', (resp) => setPaymentState('failed', resp.error.description));
  rzp.open();
};
```

Load the checkout script once, lazily, only on this step (not in the app's main bundle):

```html
<script src="https://checkout.razorpay.com/v1/checkout.js"></script>
```

## 4. Environment Variables

```bash
# backend/.env — never committed
RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxxxxx
RAZORPAY_KEY_SECRET=your_rotated_secret_here
RAZORPAY_WEBHOOK_SECRET=your_webhook_secret_here
```

```bash
# web/.env.local — public key ONLY, this is intentionally safe to expose in the built JS bundle
NEXT_PUBLIC_RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxxxxx
```

`RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET` exist only in `backend/.env` — there is no frontend env var for either, by design. Confirm both `.env` files are in `.gitignore` before committing anything.

## 5. Where This Doc Deliberately Overrides the Generic Template

| Generic template said | This doc does instead | Why |
|---|---|---|
| `POST /api/create-order`, `POST /api/verify-payment` (new, unscoped endpoints) | `POST /api/checkout`, `POST /api/checkout/verify` (your existing checkout flow, backend Section 14.5) | Keeps payment creation attached to your actual order-splitting/tax/coupon logic instead of a bolt-on endpoint that bypasses it |
| Raw `fetch` to `https://api.razorpay.com/v1/orders` | Official `razorpay` npm SDK | Matches your service-layer conventions, handles retries/signing for you |
| Client-side signature check treated as the finish line | Client check is UX-only; **webhook is authoritative** | This is the actual answer to "no frontend manipulation" — a client call can be skipped or faked, a signed server-to-server webhook can't |
| "Do not create database tables unless project already has one" | Uses your existing `Order`/`WebhookEvent` tables | You already have a database and these columns/tables are already speced (backend Sections 4.4, 14.3) |
| No mention of raw-body webhook mounting | Explicit `express.raw()` note (Section 2) | Silent, hard-to-debug failure mode if skipped |

## 6. Manual Steps Required

1. **Rotate the Razorpay key pair** in the dashboard — the one pasted into this conversation must be treated as burned regardless of whether it was a real key.
2. Register the webhook URL (`https://your-api-domain/api/webhooks/razorpay`) in the Razorpay dashboard and copy the webhook secret it generates into `RAZORPAY_WEBHOOK_SECRET`.
3. Add both `.env` files to `.gitignore` if not already present.
4. Test with Razorpay's published test card numbers in test mode before ever touching live keys.

## 7. Testing Checklist

- [ ] `POST /api/checkout` with a valid cart → returns `razorpayOrderId`, no secret in the response
- [ ] Complete a test-mode payment → `checkout/verify` returns `verified: true`
- [ ] Confirm `Order.paymentStatus` only flips to `PAID` **after** the webhook fires (check DB directly, not just the UI) — temporarily block the webhook route and confirm the order correctly stays `PENDING` even though the client-side flow "succeeded"
- [ ] Resend the same webhook event manually (Razorpay dashboard has a "resend" option) → confirm no duplicate processing (idempotency via `WebhookEvent`)
- [ ] Trigger `payment.failed` (test-mode failure card) → frontend shows an error, no order is marked paid
- [ ] Dismiss the modal without paying → frontend returns to the payment step cleanly, no server state changed

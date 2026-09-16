import crypto from 'node:crypto';
import { CONFIG } from '../config';

function sign(payload: string): string {
  return crypto.createHmac('sha256', CONFIG.razorpayWebhookSecret).update(payload).digest('hex');
}

export async function postPaymentCaptured(razorpayOrderId: string): Promise<{ status: number; json: any }> {
  const payload = JSON.stringify({
    id: `evt_${Date.now()}`,
    event: 'payment.captured',
    payload: {
      payment: {
        entity: {
          id: `pay_test_${Date.now()}`,
          order_id: razorpayOrderId,
          method: 'card',
        },
      },
    },
  });
  const signature = sign(payload);
  const res = await fetch(`${CONFIG.baseUrl}/api/webhooks/razorpay`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-razorpay-signature': signature },
    body: payload,
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

export async function postRefundProcessed(
  razorpayRefundId: string,
  razorpayPaymentId: string,
  amountPaise: number,
  orderId: string,
): Promise<{ status: number; json: any }> {
  const payload = JSON.stringify({
    id: `evt_${Date.now()}`,
    event: 'refund.processed',
    payload: {
      refund: {
        entity: {
          id: razorpayRefundId,
          payment_id: razorpayPaymentId,
          amount: amountPaise,
          status: 'processed',
          notes: { orderId, reason: 'ORDER_CANCEL' },
        },
      },
    },
  });
  const signature = sign(payload);
  const res = await fetch(`${CONFIG.baseUrl}/api/webhooks/razorpay`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-razorpay-signature': signature },
    body: payload,
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

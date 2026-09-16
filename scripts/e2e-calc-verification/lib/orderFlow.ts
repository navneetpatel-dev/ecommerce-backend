import { get, post, apiFetch } from './httpClient';

/** Clears the cart first — a prior run's cancelled order can restore items into it
 * (cartService.restoreItemsToUserCart), so re-running this script idempotently requires
 * starting from a known-empty cart rather than assuming one. */
export async function clearCart(token: string) {
  await apiFetch('DELETE', '/api/cart', { token });
}

export async function ensureAddress(token: string, preferredState?: string): Promise<{ id: string; state: string }> {
  const { json } = await get('/api/users/addresses', token);
  const addresses: any[] = json?.data ?? [];
  if (preferredState) {
    const match = addresses.find((a) => a.state?.toLowerCase() === preferredState.toLowerCase());
    if (match) return { id: match.id, state: match.state };
  } else if (addresses.length > 0) {
    return { id: addresses[0].id, state: addresses[0].state };
  }
  // Create one matching the preferred state (or a generic one if none specified).
  const state = preferredState ?? 'Delhi';
  const { status, json: created } = await post(
    '/api/users/addresses',
    {
      line1: '1 E2E Test Street',
      city: 'TestCity',
      state,
      pincode: '110001',
      lat: 28.6,
      lng: 77.2,
    },
    token,
  );
  if (status !== 201 || !created?.data?.id) {
    throw new Error(`Failed to create address: status=${status} body=${JSON.stringify(created)}`);
  }
  return { id: created.data.id, state: created.data.state };
}

export async function addToCart(token: string, variantId: string, quantity: number) {
  const { status, json } = await post('/api/cart/items', { variantId, quantity }, token);
  if (status !== 201) {
    throw new Error(`Add to cart failed: status=${status} body=${JSON.stringify(json)}`);
  }
  return json.data;
}

export type CheckoutBody = {
  shippingAddressId: string;
  paymentMethod: 'RAZORPAY' | 'COD';
  walletAmountToUse?: number;
  couponCode?: string;
  couponCodes?: string[];
};

export async function checkout(token: string, body: CheckoutBody) {
  const { status, json } = await post('/api/checkout', body, token);
  return { status, data: json?.data, error: json?.error };
}

export async function getOrder(token: string, orderId: string) {
  const { status, json } = await get(`/api/orders/${orderId}`, token);
  return { status, data: json?.data };
}

export async function pollOrderPaymentStatus(
  token: string,
  orderId: string,
  expected: string,
  timeoutMs = 8000,
): Promise<any> {
  const start = Date.now();
  let last: any = null;
  while (Date.now() - start < timeoutMs) {
    const { data } = await getOrder(token, orderId);
    last = data;
    if (data?.paymentStatus === expected) return data;
    await new Promise((r) => setTimeout(r, 300));
  }
  return last;
}

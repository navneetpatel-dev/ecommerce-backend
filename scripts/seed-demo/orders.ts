/**
 * Orders as checkout leaves them, before pricing: every customer gets ORDERS_PER_CUSTOMER
 * orders over two years, split across vendors round-robin so every selling vendor gets an
 * even share of parts. Status follows the order's age (recent ones still pending, confirmed
 * or on the road; older ones delivered, cancelled, returned or sent back to origin), and
 * every part that shipped has its shipment, tracking and any failed delivery attempts.
 *
 * Lines carry only the pre-GST unit price; `scripts/backfill-seeded-order-money.ts` then
 * prices every order with the checkout engine (GST, commission, TCS, invoices).
 */
import { HISTORY_DAYS, addDays, addHours, chance, daysAgo, id, insert, int, json, pick, random, sample, weighted } from './lib';
import { scaled } from './scale';
import type { Accounts } from './accounts';
import type { Catalog, SellableVariant } from './catalog';
import type { CouponRow } from './promotions';

export const ORDERS_PER_CUSTOMER = scaled(110, 6);
const GIFT_WRAP_FEE = 49;
const CARRIERS = ['Delhivery', 'BlueDart', 'Ecom Express', 'XpressBees', 'DTDC', 'Shadowfax'];
const FAILED_NOTES = ['Customer not available at the address', 'Address incomplete, landmark missing', 'Customer asked to reschedule', 'Premises locked'];

type PartStatus = 'PENDING' | 'CONFIRMED' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED' | 'RETURNED';
type Shipping = 'NONE' | 'TRANSIT' | 'OUT' | 'FAILED' | 'DELIVERED' | 'RTO_INITIATED' | 'RTO_DELIVERED';

/** How long ago an order was placed: weighted to the recent past, like a growing shop. */
function orderAgeDays(): number {
  return weighted([[int(0, 13) + random(), 12], [int(14, 89) + random(), 18], [int(90, HISTORY_DAYS - 5) + random(), 70]] as const);
}

/** A part's state for an order this old: what really happens to an order over time. */
function partState(age: number): { status: PartStatus; shipping: Shipping } {
  if (age < 2) return weighted([[{ status: 'PENDING', shipping: 'NONE' }, 15], [{ status: 'CONFIRMED', shipping: 'NONE' }, 85]] as const);
  if (age < 7) {
    return weighted([
      [{ status: 'CONFIRMED', shipping: 'NONE' }, 30], [{ status: 'SHIPPED', shipping: 'TRANSIT' }, 30],
      [{ status: 'SHIPPED', shipping: 'OUT' }, 10], [{ status: 'SHIPPED', shipping: 'FAILED' }, 5],
      [{ status: 'DELIVERED', shipping: 'DELIVERED' }, 20], [{ status: 'CANCELLED', shipping: 'NONE' }, 5],
    ] as const);
  }
  if (age < 14) {
    return weighted([
      [{ status: 'SHIPPED', shipping: 'TRANSIT' }, 15], [{ status: 'SHIPPED', shipping: 'RTO_INITIATED' }, 5],
      [{ status: 'DELIVERED', shipping: 'DELIVERED' }, 70], [{ status: 'CANCELLED', shipping: 'NONE' }, 10],
    ] as const);
  }
  return weighted([
    [{ status: 'DELIVERED', shipping: 'DELIVERED' }, 82], [{ status: 'CANCELLED', shipping: 'NONE' }, 7],
    [{ status: 'RETURNED', shipping: 'DELIVERED' }, 6], [{ status: 'CANCELLED', shipping: 'RTO_DELIVERED' }, 3],
    [{ status: 'SHIPPED', shipping: 'RTO_INITIATED' }, 2],
  ] as const);
}

const PROGRESS: Record<PartStatus, number> = { PENDING: 0, CONFIRMED: 1, SHIPPED: 2, DELIVERED: 3, CANCELLED: 9, RETURNED: 9 };

/** The order's status from its parts, as the app rolls it up. */
function rollUp(statuses: PartStatus[]): PartStatus {
  const standing = statuses.filter((status) => status !== 'CANCELLED' && status !== 'RETURNED');
  if (standing.length === 0) return statuses.includes('RETURNED') ? 'RETURNED' : 'CANCELLED';
  return standing.reduce((low, status) => (PROGRESS[status] < PROGRESS[low] ? status : low));
}

export async function seedOrders(accounts: Accounts, catalog: Catalog, coupons: CouponRow[]): Promise<void> {
  const vendors = accounts.sellingVendors.filter((vendor) => (catalog.liveByVendor.get(vendor.id) ?? []).length > 0);
  let cursor = 0;
  const nextVendor = () => vendors[cursor++ % vendors.length]!;
  const platformCoupons = coupons.filter((c) => !c.vendorId && ['PERCENTAGE', 'FLAT', 'CASHBACK'].includes(c.type));
  const vendorCoupons = new Map<string, CouponRow[]>();
  for (const c of coupons) {
    if (c.vendorId && ['PERCENTAGE', 'FLAT', 'CASHBACK'].includes(c.type)) vendorCoupons.set(c.vendorId, [...(vendorCoupons.get(c.vendorId) ?? []), c]);
  }
  const live = (c: CouponRow, at: Date) => c.startDate <= at && c.endDate >= at && c.status !== 'DRAFT' && c.status !== 'REJECTED';

  const orders: Array<Record<string, unknown>> = [];
  const parts: Array<Record<string, unknown>> = [];
  const items: Array<Record<string, unknown>> = [];
  const shipments: Array<Record<string, unknown>> = [];
  const attempts: Array<Record<string, unknown>> = [];
  const ledgers: Array<Record<string, unknown>> = [];
  const usages: Array<Record<string, unknown>> = [];
  let trackingSerial = 7_000_000;

  const flush = async () => {
    await insert('orders', orders.splice(0));
    await insert('sub_orders', parts.splice(0));
    await insert('order_items', items.splice(0));
    await insert('shipments', shipments.splice(0));
    await insert('shipment_attempts', attempts.splice(0));
    await insert('commission_ledgers', ledgers.splice(0));
    await insert('coupon_usages', usages.splice(0));
  };

  for (const [customerIndex, customer] of accounts.customers.entries()) {
    const addresses = accounts.addressesByUser.get(customer.id) ?? [];
    if (addresses.length === 0) continue;
    for (let n = 0; n < ORDERS_PER_CUSTOMER; n += 1) {
      const age = orderAgeDays();
      const placedAt = daysAgo(age);
      const orderId = id();
      const address = n % 4 === 0 ? addresses[0]! : pick(addresses);
      const method = chance(0.3) ? 'COD' : 'RAZORPAY';
      const partCount = weighted([[1, 50], [2, 35], [3, 15]] as const);
      const orderVendors = new Set<string>();
      const states: PartStatus[] = [];
      let subtotalPaise = 0;

      for (let p = 0; p < partCount; p += 1) {
        let vendor = nextVendor();
        for (let guard = 0; orderVendors.has(vendor.id) && guard < vendors.length; guard += 1) vendor = nextVendor();
        if (orderVendors.has(vendor.id)) break;
        orderVendors.add(vendor.id);
        const state = partState(age);
        // An unpaid online checkout stays wholly pending; COD orders are confirmed at once.
        if (state.status === 'PENDING' && method === 'COD') state.status = 'CONFIRMED';
        states.push(state.status);
        const partId = id();
        const lines: SellableVariant[] = sample(catalog.liveByVendor.get(vendor.id)!, int(1, 3));
        let partPaise = 0;
        for (const line of lines) {
          const quantity = weighted([[1, 75], [2, 20], [3, 5]] as const);
          partPaise += Math.round(line.price * 100) * quantity;
          items.push({
            id: id(), subOrderId: partId, variantId: line.variantId, productName: line.productName, quantity,
            unitPricePaise: Math.round(line.price * 100), categoryId: line.categoryId, createdAt: placedAt, updatedAt: placedAt,
          });
        }
        subtotalPaise += partPaise;
        const shippedAt = addHours(placedAt, int(18, 60));
        const deliveredAt = addDays(shippedAt, int(2, 5));
        const settledAt = state.status === 'DELIVERED' || state.status === 'RETURNED' ? deliveredAt : state.status === 'CANCELLED' ? addHours(placedAt, int(2, 30)) : placedAt;
        parts.push({
          id: partId, orderId, vendorId: vendor.id, status: state.status,
          subtotalPaise: partPaise, shippingCostPaise: partPaise < 49_900 ? 4_900 : 0,
          trackingId: state.shipping === 'NONE' ? null : `AWB${trackingSerial + 1}`,
          cancelledAt: state.status === 'CANCELLED' ? settledAt : null,
          createdAt: placedAt, updatedAt: settledAt,
        });
        if (state.status !== 'CANCELLED' || state.shipping === 'RTO_DELIVERED') {
          ledgers.push({
            id: id(), vendorId: vendor.id, subOrderId: partId, commissionRate: vendor.commissionRate,
            status: state.status === 'RETURNED' ? 'CLAWED_BACK' : 'PENDING', discountBearer: 'PLATFORM',
            saleAmountPaise: partPaise, commissionAmountPaise: Math.round((partPaise * vendor.commissionRate) / 100),
            createdAt: placedAt, updatedAt: settledAt,
          });
        }
        if (state.shipping !== 'NONE') {
          trackingSerial += 1;
          const carrier = pick(CARRIERS);
          const shipmentId = id();
          const failedTries = state.shipping === 'FAILED' || state.shipping.startsWith('RTO') ? int(1, 3) : state.shipping === 'DELIVERED' && chance(0.12) ? 1 : 0;
          const shipmentStatus = { TRANSIT: 'IN_TRANSIT', OUT: 'OUT_FOR_DELIVERY', FAILED: 'FAILED', DELIVERED: 'DELIVERED', RTO_INITIATED: 'RTO_INITIATED', RTO_DELIVERED: 'RTO_DELIVERED', NONE: 'PENDING' }[state.shipping];
          shipments.push({
            id: shipmentId, subOrderId: partId, carrier, trackingNumber: `AWB${trackingSerial}`,
            trackingUrl: `https://track.example.com/${carrier.toLowerCase().replace(/\s/g, '')}/AWB${trackingSerial}`,
            status: shipmentStatus, estimatedDeliveryDate: addDays(shippedAt, 5), shippedAt,
            deliveredAt: state.shipping === 'DELIVERED' ? deliveredAt : null,
            failureReason: failedTries > 0 && state.shipping !== 'DELIVERED' ? pick(FAILED_NOTES) : null,
            failedAttemptCount: failedTries, lastFailedAttemptAt: failedTries > 0 ? addDays(shippedAt, failedTries) : null,
            preferredRedeliverySlot: state.shipping === 'FAILED' ? pick(['Morning 9–12', 'Afternoon 12–4', 'Evening 4–8']) : null,
            codCollected: method === 'COD' && state.shipping === 'DELIVERED', codCollectedAt: method === 'COD' && state.shipping === 'DELIVERED' ? deliveredAt : null,
            rtoConfirmedAt: state.shipping === 'RTO_DELIVERED' ? addDays(shippedAt, 9) : null,
            createdAt: shippedAt, updatedAt: state.shipping === 'DELIVERED' ? deliveredAt : shippedAt,
          });
          for (let a = 1; a <= failedTries; a += 1) {
            const at = addDays(shippedAt, a);
            attempts.push({ id: id(), shipmentId, attemptNumber: a, note: pick(FAILED_NOTES), photoUrl: chance(0.4) ? `https://picsum.photos/seed/pod-${shipmentId.slice(0, 6)}-${a}/600/800` : null, attemptedAt: at, createdAt: at, updatedAt: at });
          }
        }
      }
      if (states.length === 0) continue;

      const status = rollUp(states);
      // Coupons: a quarter of orders use one that was live then; vendor coupons only on single-vendor orders.
      let coupon: CouponRow | null = null;
      if (chance(0.25)) {
        const pool = orderVendors.size === 1 && chance(0.5) ? (vendorCoupons.get([...orderVendors][0]!) ?? []) : platformCoupons;
        const usable = pool.filter((c) => live(c, placedAt));
        coupon = usable.length ? pick(usable) : null;
      }
      let discountPaise = 0;
      if (coupon?.type === 'PERCENTAGE') discountPaise = Math.min(Math.round((subtotalPaise * (coupon.value ?? 0)) / 100), (coupon.maxDiscountCap ?? Infinity) * 100);
      if (coupon?.type === 'FLAT') discountPaise = Math.min((coupon.value ?? 0) * 100, Math.floor(subtotalPaise / 2));
      // Whole rupees: the engine then splits it across lines without stray paise.
      discountPaise = Math.floor(discountPaise / 200) * 200;
      if (coupon) {
        usages.push({ id: id(), couponId: coupon.id, userId: customer.id, orderId, discountApplied: discountPaise / 100, usedAt: placedAt, createdAt: placedAt, updatedAt: placedAt });
      }
      const unpaid = status === 'PENDING';
      const prepaidCancelled = method === 'RAZORPAY' && status === 'CANCELLED';
      const paymentStatus = unpaid ? 'PENDING' : method === 'COD' ? (status === 'DELIVERED' || status === 'RETURNED' ? 'PAID' : 'PENDING') : prepaidCancelled ? 'REFUNDED' : 'PAID';
      const giftWrap = chance(0.05);
      orders.push({
        id: orderId, userId: customer.id, shippingAddressId: address.id, couponId: coupon?.id ?? null,
        appliedCouponIds: json(coupon ? [coupon.id] : []), totalAmount: subtotalPaise / 100, discountTotal: discountPaise / 100,
        status, paymentStatus, paymentMethod: method,
        razorpayOrderId: method === 'RAZORPAY' ? `order_${orderId.replace(/-/g, '').slice(0, 14)}` : null,
        razorpayPaymentId: method === 'RAZORPAY' && !unpaid ? `pay_${orderId.replace(/-/g, '').slice(14, 28)}` : null,
        cashbackDiscountBearer: coupon?.type === 'CASHBACK' ? coupon.discountBearer : null,
        cashbackVendorId: coupon?.type === 'CASHBACK' ? coupon.vendorId : null,
        cancelRefundStatus: prepaidCancelled ? 'COMPLETED' : 'NONE',
        cancelRazorpayRefundId: prepaidCancelled ? `rfnd_${orderId.replace(/-/g, '').slice(0, 14)}` : null,
        giftWrap, giftMessage: giftWrap ? pick(['Happy birthday!', 'With love, for you.', 'Congratulations on the new home!']) : null,
        giftWrapFeeAmount: giftWrap ? GIFT_WRAP_FEE : null,
        createdAt: placedAt, updatedAt: placedAt,
      });
    }
    if (customerIndex % 10 === 9) {
      await flush();
      console.log(`  orders: ${customerIndex + 1}/${accounts.customers.length} customers`);
    }
  }
  await flush();
}

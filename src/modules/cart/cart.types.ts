/** The cart as the API returns it. */
import type { UnavailableReason } from '@core/constants/statuses';
import type { CartPriceChange } from './cartPriceChange';

export type CartViewItem = {
  id: string;
  variantId: string;
  quantity: number;
  /** Server cap for this line (stock vs cart policy); the API clamps to it, so the client must not offer more. */
  maxQuantity: number;
  /** Set when the price moved since the line was added (B-55). */
  priceChange?: CartPriceChange | null;
  /** Before GST (what the pricing engine works on). */
  lineSubtotal: number;
  /** The line as the customer sees it: price per piece with GST × quantity, before any coupon. */
  lineDisplaySubtotal: number;
  isAvailable: boolean;
  unavailableReason: UnavailableReason | null;
  product: {
    id: string;
    name: string;
    slug: string;
    imageUrl: string;
    categoryId: string | null;
    /** Price per piece before GST. */
    price: number;
    /** Price per piece as the customer sees it, GST included. */
    displayPrice: number;
    vendor: {
      id: string;
      businessName: string;
      slug: string;
      logoUrl: string | null;
    };
  };
  variant: {
    sku: string;
    attributes: Record<string, string>;
    weightGrams: number;
  };
};

export type CartView = {
  id: string | null;
  items: CartViewItem[];
  /** Merchandise subtotal (available lines). */
  merchandiseSubtotal: number;
  /** Customer-facing total from PricingEngine preview (tax + est. shipping − discount). */
  total: number;
  pricingPreview?: {
    merchandiseSubtotal: number;
    discount: number;
    taxTotal: number;
    shippingTotal: number;
    shippingDisplayKey: 'FREE' | 'PAID';
    grandTotal: number;
    /**
     * The bill as the customer sees it, all GST-inclusive: items − couponSavings +
     * shippingTotal = grandTotal exactly; taxTotal is the GST inside that total.
     */
    itemsTotal: number;
    /** What coupons take off the items, GST included (a free-shipping coupon shows in shipping). */
    couponSavings: number;
    /**
     * What the preview's tax and shipping were based on. The cart has no chosen
     * address or shipping method, so anything but EXACT is an estimate the FE
     * should label as such — checkout re-quotes against the real selection.
     *
     * NO_SHIPPING_RATE means no rate matched the default address, so shipping is
     * shown as zero here but checkout will reject that address.
     */
    basisKey: 'EXACT' | 'DEFAULT_ADDRESS' | 'NO_SHIPPING_RATE' | 'NO_ADDRESS';
  };
  appliedCoupon?: {
    code: string;
    discount: number;
    cashbackAmount: number;
    type: string;
    vendorDiscountShares?: Record<string, number>;
    vendorShippingDiscountShares?: Record<string, number>;
    vendorBorneDiscountShares?: Record<string, number>;
    payNowGrandTotal?: number;
  } | null;
  appliedCoupons?: Array<{ code: string; discount: number; cashbackAmount: number; type: string }>;
  removedCouponReason?: string | null;
  /** Coupons on the cart that don't apply right now, and why. */
  inactiveCoupons?: Array<{ code: string; name: string; reason: string; reasonCode: string | null }>;
  /** Diagnostic/read-only weights; shipping APIs always recompute them server-side. */
  vendorShippingWeights?: Record<string, number>;
};

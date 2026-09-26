import { NotFoundError } from '@core/errors/NotFoundError';
import { ValidationError } from '@core/errors/ValidationError';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { AppError } from '@core/errors/AppError';
import { Cart } from '@database/models/cart.model';
import { CartItem } from '@database/models/cartItem.model';
import { Order } from '@database/models/order.model';
import { SubOrder } from '@database/models/subOrder.model';
import { OrderItem } from '@database/models/orderItem.model';
import { ProductVariant } from '@database/models/productVariant.model';
import { CommissionLedger } from '@database/models/commissionLedger.model';
import { TcsLedger } from '@database/models/tcsLedger.model';
import { Address } from '@database/models/address.model';
import { Vendor } from '@database/models/vendor.model';
import { sequelize } from '@database/models';
import { paymentsService } from '@modules/payments/payments.service';
import { cartService } from '@modules/cart/cart.service';
import { settingsService } from '@modules/settings/settings.service';
import {
  validateCouponSet,
  resolveCartCouponCodes,
  recordCouponUsagesForOrder,
  destroyCouponUsageForOrder,
  breakdownFromPerCoupon,
  type AppliedCouponBreakdownEntry,
  type CartLineForCoupon,
} from '@modules/coupons/couponEngine';
import { fromPaise, roundMoney, sumRupees, toPaise } from '@modules/pricing/money';
import { checkoutAmountDue, combinedDiscount, lineTotal } from '@modules/pricing/displayMoney';
import {
  buildVendorPricingRows,
  priceVendorRows,
  PLATFORM_VENDOR_ID,
  type PricedLine,
} from './vendorPricingPlan';
import {
  clampWalletApply,
  settleSubMinRazorpayRemainder,
} from './razorpayWalletRemainder';
import { RAZORPAY_MIN_AMOUNT_PAISE } from '@core/constants/http';
import { resolveItemAvailability } from '@core/catalog/customerVisibility';
import type {
  CancelCheckoutRequest,
  CreateCheckoutRequest,
  CheckoutQuoteRequest,
} from './checkout.dto';
import type { Coupon } from '@database/models/coupon.model';
import { walletService } from '@modules/wallet/wallet.service';
import { WALLET_DESCRIPTIONS } from '@modules/wallet/wallet.constants';
import { rollbackOrderWalletIfNeeded } from '@modules/wallet/walletOrderRollback';
import {
  ORDER_STATUS,
  PAYMENT_STATUS,
  PAYMENT_METHOD,
  COMMISSION_STATUS,
  DISCOUNT_BEARER,
  WALLET_REFERENCE_TYPE,
  UNAVAILABLE_REASON,
  allSubOrdersCancellable,
} from '@core/constants/statuses';
import { ERROR_CODES, ERROR_MESSAGES } from '@core/constants/errors';
import { resolveCodForCatalogItems } from '@modules/products/pdpPolicy';
import { notifyOrderConfirmed } from '@modules/notifications/orderNotifications';
import { notificationsService } from '@modules/notifications/notifications.service';
import { buildCheckoutOrderTotals, resolveShippingDisplayKey, resolveTaxDisplayKey } from './checkoutOrderTotals';
import {
  taxInvoiceSnapshotLine,
  type TaxInvoiceSnapshotLine,
} from '@modules/pricing/taxInvoiceSnapshot';
import {
  giftWrapInvoiceLine,
  platformInvoiceLineTotalPaise,
  shippingInvoiceLine,
  unissuedPlatformInvoice,
  type PlatformInvoiceSnapshot,
} from '@modules/pricing/platformFeeInvoice';
import { isIntraStateSupply } from '@modules/pricing/gstPlaceOfSupply';

/** Flat platform fee for checkout-time gift wrapping (v1: hardcoded, not vendor-specific). */
export const GIFT_WRAP_FEE_RUPEES = 49;

function resolveGiftWrapFee(giftWrap?: boolean): number {
  return giftWrap ? GIFT_WRAP_FEE_RUPEES : 0;
}

/** Moved to pricing/tcsLedger: TCS is recorded at dispatch. Re-exported for callers. */
export { persistTcsCollectionLedger } from '@modules/pricing/tcsLedger';

type CartWithItems = Cart & {
  items: (CartItem & { variant: ProductVariant & { product: any } })[];
};

type OrderForRollback = Order & {
  subOrders?: (SubOrder & { items?: OrderItem[] })[];
};

async function loadUserCart(userId: string, transaction?: any): Promise<CartWithItems> {
  const cartResult = await Cart.findOne({
    where: { userId },
    include: [{
      model: CartItem,
      as: 'items',
      include: [{
        model: ProductVariant,
        as: 'variant',
        include: [{
          association: 'product',
          include: [{ model: Vendor, as: 'vendor' }],
        }],
      }],
    }],
    transaction,
  });

  if (!cartResult) {
    throw new ValidationError(ERROR_MESSAGES.CART_EMPTY);
  }

  const cart = cartResult as CartWithItems;
  if (!cart.items || cart.items.length === 0) {
    throw new ValidationError(ERROR_MESSAGES.CART_EMPTY);
  }

  return cart;
}

function assertCartItemsAvailable(cart: CartWithItems) {
  const unavailable = cart.items
    .map((item) => {
      const product = item.variant?.product;
      const vendor = product?.vendor ?? product?.Vendor ?? null;
      const availability = resolveItemAvailability({
        product,
        vendor,
        stock: Number(item.variant?.stock ?? 0),
        quantity: Number(item.quantity),
      });
      if (availability.isAvailable) return null;
      return {
        cartItemId: item.id,
        variantId: item.variantId,
        productName: product?.name ?? null,
        unavailableReason: availability.unavailableReason,
      };
    })
    .filter(Boolean);

  if (unavailable.length > 0) {
    throw new AppError(ERROR_MESSAGES.ITEMS_UNAVAILABLE, 422, ERROR_CODES.ITEMS_UNAVAILABLE, {
      items: unavailable,
    });
  }
}

/**
 * Row-locks every distinct variant in the cart (SELECT ... FOR UPDATE) and re-checks stock
 * against the locked values. Must run inside the order-creation transaction, after the initial
 * (unlocked) `assertCartItemsAvailable` check and before any stock decrement, so two concurrent
 * checkouts for the same last unit serialize on the lock instead of both reading stale stock.
 */
async function lockCartVariantsAndAssertStock(cart: CartWithItems, transaction: any) {
  const variantIds = [...new Set(cart.items.map((item) => String(item.variantId)))];
  // `ORDER BY id` is required, not cosmetic: without it, Postgres doesn't guarantee the order it
  // acquires locks for a multi-row `WHERE id IN (...) FOR UPDATE`. Two concurrent checkouts
  // sharing overlapping variants, listed in different orders (e.g. cart [X, Y] vs. cart [Y, X]),
  // could then lock them in opposite orders and deadlock. Sorting both transactions' lock
  // acquisition into the same deterministic (ascending id) order rules that out entirely.
  const lockedVariants = await ProductVariant.findAll({
    where: { id: variantIds },
    order: [['id', 'ASC']],
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  const lockedById = new Map(lockedVariants.map((variant) => [String(variant.id), variant]));

  const unavailable = cart.items
    .map((item) => {
      const locked = lockedById.get(String(item.variantId));
      if (!locked || Number(locked.stock) < Number(item.quantity)) {
        return {
          cartItemId: item.id,
          variantId: item.variantId,
          productName: item.variant?.product?.name ?? null,
          unavailableReason: UNAVAILABLE_REASON.OUT_OF_STOCK,
        };
      }
      return null;
    })
    .filter(Boolean);

  if (unavailable.length > 0) {
    throw new AppError(ERROR_MESSAGES.ITEMS_UNAVAILABLE, 422, ERROR_CODES.ITEMS_UNAVAILABLE, {
      items: unavailable,
    });
  }

  return lockedById;
}

function catalogItemsForCod(
  items: (CartItem & { variant: ProductVariant & { product: any } })[],
) {
  return items.map((item) => {
    const product = item.variant?.product;
    return {
      categoryId: product?.categoryId ?? null,
      codEnabled: product?.codEnabled ?? null,
      vendor: product?.vendor ?? product?.Vendor ?? null,
    };
  });
}

function toCouponLines(
  items: (CartItem & { variant: ProductVariant & { product: any } })[],
): CartLineForCoupon[] {
  return items.map((item) => {
    const product = item.variant.product;
    return {
      productId: String(product.id),
      variantId: String(item.variantId),
      categoryId: product.categoryId ? String(product.categoryId) : null,
      vendorId: product.vendorId ? String(product.vendorId) : null,
      unitPrice: Number(item.variant.price),
      quantity: Number(item.quantity),
      weightGrams: Number(item.variant.weightGrams ?? 500),
      isCustomerVisible: true,
    };
  });
}

function resolveCheckoutCouponCodes(
  data: { couponCode?: string | null; couponCodes?: string[] },
  cart: { couponCode?: string | null; couponCodes?: string[] | null },
): string[] {
  if (data.couponCodes && data.couponCodes.length > 0) {
    return [...new Set(data.couponCodes.map((c) => c.trim().toUpperCase()).filter(Boolean))];
  }
  if (data.couponCode?.trim()) {
    return [data.couponCode.trim().toUpperCase()];
  }
  return resolveCartCouponCodes(cart);
}

/** Map cart rows into the normalized shape `vendorPricingPlan` prices. */
function toPricedLines(
  items: (CartItem & { variant: ProductVariant & { product: any } })[],
): PricedLine[] {
  return items.map((item) => ({
    key: String(item.id),
    vendorId: item.variant.product.vendorId || PLATFORM_VENDOR_ID,
    unitPrice: Number(item.variant.price),
    quantity: Number(item.quantity),
    categoryId: item.variant.product.categoryId ?? null,
    weightGrams: item.variant.weightGrams ?? null,
  }));
}

export class CheckoutService {
  async getQuote(userId: string, data: CheckoutQuoteRequest): Promise<{
    vendorBreakdowns: Array<{
      vendorId: string;
      vendor: { id: string; businessName: string; slug: string; logoUrl: string | null };
      items: Array<{
        id: string;
        variantId: string;
        productName: string;
        quantity: number;
        unitPrice: number;
        lineSubtotal: number;
        lineTotal: number;
      }>;
      subtotal: number;
      shippingCost: number;
      tax: { cgst: number; sgst: number; igst: number; total: number };
      discount: number;
      tcsAmount: number;
      commissionAmount: number;
      netPayout: number;
      total: number;
    }>;
    grandTotal: number;
    giftWrapFeeAmount: number;
    cashbackAmount: number;
    walletBalance: number;
    walletAmountToUse: number;
    amountDue: number;
    maxWalletApplicable: number;
    appliedCoupon: { code: string; discount: number; cashbackAmount?: number } | null;
    appliedCoupons: Array<{ code: string; discount: number; cashbackAmount?: number }>;
    codAvailable: boolean;
    orderTotals: ReturnType<typeof buildCheckoutOrderTotals>;
  }> {
    const cart = await loadUserCart(userId);

    assertCartItemsAvailable(cart);

    const shippingAddress = await Address.findOne({
      where: { id: data.shippingAddressId, userId },
    });
    if (!shippingAddress) {
      throw new NotFoundError('Shipping address');
    }

    const availableItems = cart.items.filter((item) => {
      const product = item.variant?.product;
      const vendor = product?.vendor ?? product?.Vendor ?? null;
      return resolveItemAvailability({
        product,
        vendor,
        stock: Number(item.variant?.stock ?? 0),
        quantity: Number(item.quantity),
      }).isAvailable;
    });
    const quoteCart = { ...cart, items: availableItems } as CartWithItems;

    const settings = await settingsService.getPlatformSettings();
    const itemById = new Map(quoteCart.items.map((item) => [String(item.id), item]));
    const plan = await buildVendorPricingRows({
      lines: toPricedLines(quoteCart.items),
      destination: {
        pincode: shippingAddress.pincode,
        state: shippingAddress.state,
      },
      shippingMethodByVendor: data.shippingMethodByVendor,
      settings,
      onMissingRate: 'throw',
    });
    const { rows: baseVendorRows, shippingByVendor, shippingTotal } = plan;

    const couponCodes = resolveCheckoutCouponCodes(data, cart);
    let discount = 0;
    let cashbackAmount = 0;
    let applied: { code: string; discount: number; cashbackAmount?: number } | null = null;
    let appliedCoupons: Array<{ code: string; discount: number; cashbackAmount?: number }> = [];
    let vendorDiscountShares: Record<string, number> = {};
    let vendorShippingDiscountShares: Record<string, number> = {};
    let vendorBorneDiscountShares: Record<string, number> = {};

    if (couponCodes.length > 0) {
      const result = await validateCouponSet({
        codes: couponCodes,
        userId,
        lines: toCouponLines(quoteCart.items),
        shippingTotal,
        shippingByVendor,
      });
      if (!result.valid) {
        throw new ValidationError(result.reason ?? ERROR_MESSAGES.COUPON_INVALID);
      }
      discount = result.discount;
      cashbackAmount = result.cashbackAmount;
      vendorDiscountShares = result.vendorDiscountShares;
      vendorShippingDiscountShares = result.vendorShippingDiscountShares;
      vendorBorneDiscountShares = result.vendorBorneDiscountShares;
      appliedCoupons = result.perCoupon.map((entry) => ({
        code: entry.code,
        discount: entry.discount,
        cashbackAmount: entry.cashbackAmount,
      }));
      if (result.primaryCoupon) {
        applied = {
          code: result.coupons.map((c) => c.code).join('+'),
          discount,
          cashbackAmount,
        };
      }
    }

    const { pricedByVendor } = priceVendorRows({
      rows: baseVendorRows,
      shares: {
        vendorDiscountShares,
        vendorShippingDiscountShares,
        vendorBorneDiscountShares,
      },
      shippingStateCode: shippingAddress.state,
      settings,
    });

    const vendorBreakdowns = baseVendorRows.map((row) => {
      const vendor = row.vendor;
      const r = pricedByVendor[row.vendorId]!.rupees;
      return {
        vendorId: row.vendorId,
        vendor: vendor
          ? {
              id: vendor.id,
              businessName: vendor.businessName,
              slug: vendor.slug,
              logoUrl: vendor.logoUrl ?? null,
            }
          : { id: row.vendorId, businessName: 'Marketplace', slug: 'platform', logoUrl: null },
        items: row.lines.map((line) => {
          const item = itemById.get(line.key)!;
          const priced = r.lines.find((entry) => entry.key === line.key);
          return {
            id: item.id,
            variantId: item.variantId,
            productName: item.variant.product.name,
            quantity: item.quantity,
            unitPrice: line.unitPrice,
            lineSubtotal: priced?.lineSubtotal ?? 0,
            lineTotal: priced ? lineTotal(priced.taxableAmount, priced.tax.total) : 0,
          };
        }),
        subtotal: r.subtotal,
        /** Net of shipping discount — `shippingCharged`, not the gross rate. */
        shippingCost: r.shippingCharged,
        shippingDisplayKey: resolveShippingDisplayKey(r.shippingCharged),
        tax: {
          cgst: r.tax.cgst,
          sgst: r.tax.sgst,
          igst: r.tax.igst,
          total: r.tax.total,
        },
        taxDisplayKey: resolveTaxDisplayKey(r.tax),
        discount: combinedDiscount(r.merchandiseDiscount, r.shippingDiscount),
        tcsAmount: r.tcsAmount,
        commissionAmount: r.commissionAmount,
        netPayout: r.netPayout,
        total: r.customerTotal,
      };
    });

    const merchandiseGrandTotal = sumRupees(vendorBreakdowns.map((row) => row.total));
    // Flat platform fee, not tied to any vendor — added on top the same way
    // shipping/tax already flow into grandTotal, so it participates in the
    // wallet/COD/Razorpay math below without touching those computations.
    const giftWrapFeeAmount = resolveGiftWrapFee(data.giftWrap);
    const grandTotal = roundMoney(merchandiseGrandTotal + giftWrapFeeAmount);
    const walletBalance = await walletService.getBalance(userId);
    let walletAmountToUse = clampWalletApply(
      Number(data.walletAmountToUse ?? 0),
      walletBalance,
      grandTotal,
    );
    let amountDue = checkoutAmountDue(grandTotal, walletAmountToUse);
    // Mirror place-order sub-min absorb so checkout UI matches settlement.
    const quoteSettled = settleSubMinRazorpayRemainder(
      grandTotal,
      walletAmountToUse,
      walletBalance,
    );
    if (!('reject' in quoteSettled)) {
      walletAmountToUse = quoteSettled.walletAmountUsed;
      amountDue = quoteSettled.amountDue;
    }
    const maxWalletApplicable = Math.min(walletBalance, grandTotal);
    const codAvailable = await resolveCodForCatalogItems(
      catalogItemsForCod(quoteCart.items),
      grandTotal,
    );

    return {
      vendorBreakdowns,
      grandTotal,
      giftWrapFeeAmount,
      orderTotals: buildCheckoutOrderTotals(vendorBreakdowns, giftWrapFeeAmount),
      cashbackAmount,
      walletBalance,
      walletAmountToUse,
      amountDue,
      maxWalletApplicable,
      appliedCoupon: applied,
      appliedCoupons,
      codAvailable,
    };
  }

  async createOrderFromCart(
    userId: string,
    data: CreateCheckoutRequest,
  ): Promise<{ orderId: string; razorpayOrderId?: string; amount?: number; currency?: string; keyId?: string }> {
    const orderResult = await sequelize.transaction(async (t) => {
      const cart = await loadUserCart(userId, t);

      assertCartItemsAvailable(cart);
      await lockCartVariantsAndAssertStock(cart, t);

      const shippingAddress = await Address.findOne({
        where: { id: data.shippingAddressId, userId },
        transaction: t,
      });

      if (!shippingAddress) {
        throw new NotFoundError('Shipping address');
      }

      const settings = await settingsService.getPlatformSettings();
      const itemById = new Map(cart.items.map((item) => [String(item.id), item]));
      const plan = await buildVendorPricingRows({
        lines: toPricedLines(cart.items),
        destination: {
          pincode: shippingAddress.pincode,
          state: shippingAddress.state,
        },
        shippingMethodByVendor: data.shippingMethodByVendor,
        settings,
        onMissingRate: 'throw',
        transaction: t,
      });
      const { shippingByVendor, shippingTotal } = plan;
      const vendorPrep = Object.fromEntries(
        plan.rows.map((row) => [
          row.vendorId,
          { row, items: row.lines.map((line) => itemById.get(line.key)!) },
        ]),
      );

      const couponCodes = resolveCheckoutCouponCodes(data, cart);
      let discountTotal = 0;
      let cashbackAmount = 0;
      let cashbackDiscountBearer: 'PLATFORM' | 'VENDOR' | null = null;
      let cashbackVendorId: string | null = null;
      let coupons: Coupon[] = [];
      let primaryCoupon: Coupon | null = null;
      let vendorDiscountShares: Record<string, number> = {};
      let vendorShippingDiscountShares: Record<string, number> = {};
      let vendorBorneDiscountShares: Record<string, number> = {};
      let appliedCouponBreakdown: AppliedCouponBreakdownEntry[] = [];

      if (couponCodes.length > 0) {
        const result = await validateCouponSet({
          codes: couponCodes,
          userId,
          lines: toCouponLines(cart.items),
          shippingTotal,
          shippingByVendor,
          transaction: t,
        });
        if (!result.valid) {
          throw new ValidationError(result.reason ?? ERROR_MESSAGES.COUPON_INVALID);
        }
        discountTotal = result.discount;
        cashbackAmount = result.cashbackAmount;
        coupons = result.coupons;
        primaryCoupon = result.primaryCoupon;
        vendorDiscountShares = result.vendorDiscountShares;
        vendorShippingDiscountShares = result.vendorShippingDiscountShares;
        vendorBorneDiscountShares = result.vendorBorneDiscountShares;
        appliedCouponBreakdown = breakdownFromPerCoupon(result.perCoupon, coupons);
        const cashbackCoupon = coupons.find((c) => c.type === 'CASHBACK');
        if (cashbackCoupon) {
          cashbackDiscountBearer =
            cashbackCoupon.discountBearer === DISCOUNT_BEARER.VENDOR
              ? DISCOUNT_BEARER.VENDOR
              : DISCOUNT_BEARER.PLATFORM;
          cashbackVendorId = cashbackCoupon.vendorId ?? null;
        }
      }

      const { pricedByVendor, bearerByVendor, customerGrandTotalPaise } = priceVendorRows({
        rows: plan.rows,
        shares: {
          vendorDiscountShares,
          vendorShippingDiscountShares,
          vendorBorneDiscountShares,
        },
        shippingStateCode: shippingAddress.state,
        settings,
      });

      // Summed from the engine's paise breakdown, so the order totals are exact.
      let merchandisePaise = 0;
      let orderTaxPaise = 0;
      let orderShippingPaise = 0;
      for (const priced of Object.values(pricedByVendor)) {
        merchandisePaise += priced.paise.subtotalPaise;
        orderTaxPaise += priced.paise.tax.total;
        orderShippingPaise += priced.paise.shippingChargedPaise;
      }
      const merchandiseSubtotal = fromPaise(merchandisePaise);
      const orderTaxTotal = fromPaise(orderTaxPaise);
      const orderShippingTotal = fromPaise(orderShippingPaise);

      // Flat platform fee, not part of any vendor's priced rows — added on top
      // the same way the quote adds it to grandTotal, so it flows into COD
      // eligibility, wallet clamp, amountDue and the Razorpay order amount below.
      const giftWrapFeeAmount = resolveGiftWrapFee(data.giftWrap);
      const orderTotalRupees = roundMoney(fromPaise(customerGrandTotalPaise) + giftWrapFeeAmount);
      if (data.paymentMethod === PAYMENT_METHOD.COD) {
        const codAvailable = await resolveCodForCatalogItems(
          catalogItemsForCod(cart.items),
          orderTotalRupees,
        );
        if (!codAvailable) {
          throw new ValidationError(ERROR_MESSAGES.COD_NOT_AVAILABLE);
        }
      }
      const requestedWallet = Math.max(0, Number(data.walletAmountToUse ?? 0));
      let walletAmountUsed = 0;
      let walletBalance: number | null = null;
      if (requestedWallet > 0) {
        if (data.paymentMethod === PAYMENT_METHOD.COD) {
          throw new ValidationError(ERROR_MESSAGES.WALLET_INVALID_AMOUNT);
        }
        walletBalance = await walletService.getBalance(userId, t);
        walletAmountUsed = clampWalletApply(
          requestedWallet,
          walletBalance,
          orderTotalRupees,
        );
      }
      let amountDue = checkoutAmountDue(orderTotalRupees, walletAmountUsed);

      // Absorb sub-₹1 Razorpay remainder into full wallet when possible; else reject
      // before order create / wallet debit (avoids debit-then-fail at PG create).
      if (data.paymentMethod === PAYMENT_METHOD.RAZORPAY) {
        const duePaise = toPaise(amountDue);
        if (duePaise > 0 && duePaise < RAZORPAY_MIN_AMOUNT_PAISE) {
          if (walletBalance == null) {
            walletBalance = await walletService.getBalance(userId, t);
          }
          const settled = settleSubMinRazorpayRemainder(
            orderTotalRupees,
            walletAmountUsed,
            walletBalance,
          );
          if ('reject' in settled) {
            throw new ValidationError(ERROR_MESSAGES.ORDER_AMOUNT_BELOW_RAZORPAY_MIN);
          }
          walletAmountUsed = settled.walletAmountUsed;
          amountDue = settled.amountDue;
        }
      }

      // Gift wrapping is the platform's own service: its fee includes 18% GST and gets
      // the platform's tax invoice. Amounts freeze now; the number is issued at dispatch
      // (pricing/taxInvoiceIssue), so an order cancelled before shipping gets none.
      let platformInvoiceSnapshot: PlatformInvoiceSnapshot | null = null;
      const platformIntraState = isIntraStateSupply(settings.platformState, shippingAddress.state);
      if (data.giftWrap && giftWrapFeeAmount > 0) {
        const intraState = platformIntraState;
        const line = giftWrapInvoiceLine(giftWrapFeeAmount, intraState);
        platformInvoiceSnapshot = {
          invoiceNumber: null,
          issuedAt: null,
          intraState,
          lines: [line],
          totalPaise: platformInvoiceLineTotalPaise(line),
        };
      }

      const orderRow = await Order.create({
        userId,
        shippingAddressId: data.shippingAddressId,
        couponId: primaryCoupon?.id ?? null,
        appliedCouponIds: coupons.map((c) => c.id),
        appliedCouponBreakdown,
        totalAmount: orderTotalRupees,
        discountTotal,
        merchandiseSubtotal,
        taxTotal: orderTaxTotal,
        shippingTotal: orderShippingTotal,
        amountDue,
        giftWrap: data.giftWrap ?? false,
        giftMessage: data.giftWrap ? (data.giftMessage ?? null) : null,
        giftWrapFeeAmount: data.giftWrap ? giftWrapFeeAmount : null,
        platformInvoiceSnapshot,
        status: ORDER_STATUS.PENDING,
        paymentStatus: PAYMENT_STATUS.PENDING,
        paymentMethod: data.paymentMethod,
        walletAmountUsed,
        pendingCashbackAmount: cashbackAmount,
        cashbackCreditedAt: null,
        cashbackDiscountBearer,
        cashbackVendorId,
        originalTotalAmount: orderTotalRupees,
        razorpayAmountPaid:
          data.paymentMethod === PAYMENT_METHOD.COD ? 0 : Math.max(0, amountDue),
        razorpayOrderId: null,
        razorpayPaymentId: null,
      }, { transaction: t });

      if (walletAmountUsed > 0) {
        await walletService.debit(
          userId,
          walletAmountUsed,
          { type: WALLET_REFERENCE_TYPE.ORDER, id: orderRow.id },
          `${WALLET_DESCRIPTIONS.CHECKOUT_SPEND} #${orderRow.id.slice(0, 8).toUpperCase()}`,
          t,
        );
      }

      // Wallet covers full amount — mark paid inside the same transaction.
      if (data.paymentMethod === PAYMENT_METHOD.RAZORPAY && amountDue <= 0) {
        await orderRow.update(
          {
            paymentStatus: PAYMENT_STATUS.PAID,
            status: ORDER_STATUS.CONFIRMED,
          },
          { transaction: t },
        );
        if (coupons.length > 0) {
          await recordCouponUsagesForOrder({
            coupons,
            breakdown: appliedCouponBreakdown,
            discountTotal,
            userId,
            orderId: orderRow.id,
            actorId: userId,
            transaction: t,
          });
        }
      }

      // COD has no payment webhook — confirm placement so fulfillment + reports can see it.
      if (data.paymentMethod === PAYMENT_METHOD.COD) {
        await orderRow.update({ status: ORDER_STATUS.CONFIRMED }, { transaction: t });
      }

      for (const [vendorId, prep] of Object.entries(vendorPrep)) {
        const priced = pricedByVendor[vendorId]!;
        const r = priced.rupees;
        const p = priced.paise;
        const bearer = bearerByVendor[vendorId] ?? DISCOUNT_BEARER.PLATFORM;
        const resolvedVendorId = vendorId === 'platform' ? null : vendorId;

        const subOrder = await SubOrder.create({
          orderId: orderRow.id,
          vendorId: resolvedVendorId,
          status: ORDER_STATUS.PENDING,
          shippingCharged: r.shippingCharged,
          customerTotal: r.customerTotal,
          taxBreakdown: r.tax,
          subtotalPaise: p.subtotalPaise,
          shippingCostPaise: p.shippingCostPaise,
          shippingDiscountAmountPaise: p.shippingDiscountPaise,
          taxAmountPaise: p.tax.total,
          taxableAmountPaise: p.taxablePaise,
          discountAmountPaise: p.merchandiseDiscountPaise,
          commissionAmountPaise: p.commissionPaise,
          tcsAmountPaise: p.tcsPaise,
          netPayoutAmountPaise: p.netPayoutPaise,
          roundingAdjustmentPaise: p.roundingAdjustmentPaise,
          // Section 52 TCS rate the sale was priced with; its TCS is recorded at dispatch.
          tcsRatePercent: Number(settings.tcsRatePercent ?? 0),
          // Shipping is the platform's own service: 18% GST included in the fee, on the
          // platform's invoice for this part (numbered at its dispatch), not the vendor's.
          shippingInvoiceSnapshot:
            p.shippingChargedPaise > 0
              ? unissuedPlatformInvoice(
                  [shippingInvoiceLine(p.shippingChargedPaise, platformIntraState)],
                  platformIntraState,
                )
              : null,
          // The tax invoice number is issued at dispatch (pricing/taxInvoiceIssue).
          taxInvoiceNumber: null,
          taxInvoiceIssuedAt: null,
          trackingId: null,
        }, { transaction: t });

        const lineByKey = Object.fromEntries(
          priced.paise.lines.map((row) => [row.key, row]),
        );
        const lineRupeesByKey = Object.fromEntries(
          priced.rupees.lines.map((row) => [row.key, row]),
        );

        const invoiceLines: TaxInvoiceSnapshotLine[] = [];
        for (const item of prep.items) {
          const linePaise = lineByKey[item.id]!;
          const lineRupees = lineRupeesByKey[item.id]!;
          const orderItem = await OrderItem.create({
            subOrderId: subOrder.id,
            variantId: item.variantId,
            productName: item.variant.product.name,
            quantity: item.quantity,
            lineSubtotal: lineRupees.lineSubtotal,
            lineTotal: lineTotal(lineRupees.taxableAmount, lineRupees.tax.total),
            taxBreakdown: lineRupees.tax,
            unitPricePaise: linePaise.unitPricePaise,
            discountAmountPaise: linePaise.discountPaise,
            taxableAmountPaise: linePaise.taxablePaise,
            taxAmountPaise: linePaise.tax.total,
            commissionAmountPaise: linePaise.commissionPaise,
            tcsAmountPaise: linePaise.tcsPaise,
            netPayoutAmountPaise: linePaise.netPayoutPaise,
          }, { transaction: t });
          invoiceLines.push(taxInvoiceSnapshotLine(orderItem.id, linePaise));

          await item.variant.decrement('stock', {
            by: item.quantity,
            transaction: t,
          });
        }
        await subOrder.update(
          // The vendor's invoice is for the goods: taxable value + GST. The shipping on
          // this part is on the platform's shipping invoice.
          { taxInvoiceSnapshot: { totalPaise: p.taxablePaise + p.tax.total, lines: invoiceLines } },
          { transaction: t },
        );

        if (vendorId !== 'platform') {
          await CommissionLedger.create({
            vendorId,
            subOrderId: subOrder.id,
            commissionRate:
              p.commissionBasePaise > 0
                ? Math.round((p.commissionPaise / p.commissionBasePaise) * 10000) / 100
                : prep.row.commissionRatePercent,
            discountBearer: bearer,
            saleAmountPaise: p.commissionBasePaise,
            commissionAmountPaise: p.commissionPaise,
            taxableAmountPaise: p.taxablePaise,
            discountAmountPaise: p.merchandiseDiscountPaise,
            taxAmountPaise: p.tax.total,
            tcsAmountPaise: p.tcsPaise,
            netPayoutAmountPaise: p.netPayoutPaise,
            shippingCollectedPaise: p.shippingChargedPaise,
            // Frozen here so a later platform rate change only affects later sales.
            tdsRatePercent: settings.tdsRatePercent,
            status: COMMISSION_STATUS.PENDING,
          }, { transaction: t });

          // TCS is recorded when the part is dispatched and invoiced (pricing/tcsLedger),
          // at the rate frozen on the sub-order here.
        }
      }

      // Usage is webhook-driven for Razorpay. COD has no webhook — record on place.
      if (coupons.length > 0 && data.paymentMethod === PAYMENT_METHOD.COD) {
        await recordCouponUsagesForOrder({
          coupons,
          breakdown: appliedCouponBreakdown,
          discountTotal,
          userId,
          orderId: orderRow.id,
          actorId: userId,
          transaction: t,
        });
      }

      await cart.update({ couponCode: null, couponCodes: [] }, { transaction: t });

      await CartItem.destroy({
        where: { cartId: cart.id },
        transaction: t,
      });

      return orderRow;
    });

    const order = orderResult;

    if (data.paymentMethod === PAYMENT_METHOD.RAZORPAY) {
      const walletUsed = Number(order.walletAmountUsed ?? 0);
      const remainder = checkoutAmountDue(order.totalAmount, walletUsed);
      if (remainder <= 0 || order.paymentStatus === PAYMENT_STATUS.PAID) {
        void notifyOrderConfirmed(order.id);
        return { orderId: order.id };
      }
      const razorpay = await paymentsService.createRazorpayOrderForOrder(order, remainder);
      return {
        orderId: order.id,
        ...razorpay,
      };
    }

    void notifyOrderConfirmed(order.id);
    return { orderId: order.id };
  }

  async cancelPendingCheckout(
    userId: string,
    data: CancelCheckoutRequest,
  ): Promise<{ restored: boolean; orderId: string }> {
    const orderResult = await sequelize.transaction(async (t) => {
      const locked = await Order.findByPk(data.orderId, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (!locked) {
        throw new NotFoundError('Order');
      }
      if (locked.userId !== userId) {
        throw new ForbiddenError(ERROR_MESSAGES.NO_ACCESS_TO_ORDER);
      }
      if (locked.paymentStatus === PAYMENT_STATUS.PAID) {
        throw new ValidationError(ERROR_MESSAGES.CHECKOUT_PAID_CANNOT_CANCEL);
      }
      if (locked.status === ORDER_STATUS.CANCELLED) {
        const walletRestored = await rollbackOrderWalletIfNeeded(locked, userId, t);
        if (walletRestored) {
          await locked.update({ walletAmountUsed: 0 }, { transaction: t });
        }
        return { restored: walletRestored, orderId: locked.id };
      }

      const orderResult = await Order.findByPk(data.orderId, {
        include: [
          {
            model: SubOrder,
            as: 'subOrders',
            include: [{ model: OrderItem, as: 'items' }],
          },
        ],
        transaction: t,
      });

      if (!orderResult) {
        throw new NotFoundError('Order');
      }

      const order = orderResult as OrderForRollback;

      // COD orders stay paymentStatus PENDING all the way to delivery, so the PAID check above
      // never catches them — this is the only cancel path a COD order can reach at all (the
      // frontend's own cancel button requires paymentStatus === PAID). Without this guard a
      // customer could cancel their own already-SHIPPED COD order, restocking inventory and
      // deleting commission/TCS ledgers for goods the vendor already fulfilled.
      if (!allSubOrdersCancellable(order.subOrders ?? [])) {
        throw new ValidationError(ERROR_MESSAGES.ORDER_CANCEL_ITEMS_SHIPPED);
      }

      const restoreLines: Array<{ variantId: string; quantity: number }> = [];

      for (const subOrder of order.subOrders ?? []) {
        for (const item of subOrder.items ?? []) {
          restoreLines.push({ variantId: item.variantId, quantity: item.quantity });
          await ProductVariant.increment('stock', {
            by: item.quantity,
            where: { id: item.variantId },
            transaction: t,
          });
        }

        await subOrder.update({ status: ORDER_STATUS.CANCELLED }, { transaction: t });

        await CommissionLedger.destroy({
          where: { subOrderId: subOrder.id, status: COMMISSION_STATUS.PENDING },
          transaction: t,
        });
        await TcsLedger.destroy({
          where: { subOrderId: subOrder.id },
          transaction: t,
        });
      }

      await destroyCouponUsageForOrder(order.id, t);

      await cartService.restoreItemsToUserCart(userId, restoreLines, t);

      await rollbackOrderWalletIfNeeded(order, userId, t);

      await order.update(
        {
          status: ORDER_STATUS.CANCELLED,
          paymentStatus: PAYMENT_STATUS.FAILED,
          walletAmountUsed: 0,
        },
        { transaction: t },
      );

      void notificationsService.sendOrderCancelled(order.userId, order.id, {
        orderId: order.id,
        orderNumber: order.id.slice(0, 8).toUpperCase(),
      });

      return { restored: true, orderId: order.id };
    });

    return { restored: orderResult.restored, orderId: orderResult.orderId };
  }
}

export const checkoutService = new CheckoutService();

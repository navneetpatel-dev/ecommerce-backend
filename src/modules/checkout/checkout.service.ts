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
import { getRatesForQuote } from '@modules/shipping/shipping.service';
import { taxService } from '@modules/tax/tax.service';
import { settingsService } from '@modules/settings/settings.service';
import { categoriesService } from '@modules/categories/categories.service';
import {
  validateCouponSet,
  resolveCartCouponCodes,
  recordCouponUsage,
  resolveVendorDiscountBearer,
  type CartLineForCoupon,
} from '@modules/coupons/couponEngine';
import { pricingService } from '@modules/pricing/pricing.service';
import { fromPaise } from '@modules/pricing/money';
import { resolveItemAvailability } from '@core/catalog/customerVisibility';
import type {
  CancelCheckoutRequest,
  CreateCheckoutRequest,
  CheckoutQuoteRequest,
} from './checkout.dto';
import type { Coupon } from '@database/models/coupon.model';
import { walletService } from '@modules/wallet/wallet.service';
import { WALLET_DESCRIPTIONS } from '@modules/wallet/wallet.constants';
import {
  ORDER_STATUS,
  PAYMENT_STATUS,
  PAYMENT_METHOD,
  COMMISSION_STATUS,
  DISCOUNT_BEARER,
  WALLET_REFERENCE_TYPE,
} from '@core/constants/statuses';
import { ERROR_CODES, ERROR_MESSAGES } from '@core/constants/errors';
import { notifyOrderConfirmed } from '@modules/notifications/orderNotifications';
import { notificationsService } from '@modules/notifications/notifications.service';
function groupBy<T>(array: T[], keyFn: (item: T) => string): Record<string, T[]> {
  return array.reduce((acc, item) => {
    const key = keyFn(item);
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {} as Record<string, T[]>);
}

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

function requestedMethod(method?: string): 'STANDARD' | 'EXPRESS' {
  const normalized = (method || 'STANDARD').toUpperCase();
  if (normalized !== 'STANDARD' && normalized !== 'EXPRESS') {
    throw new ValidationError(`Unsupported shipping method: ${method}`);
  }
  return normalized;
}

function lineWeightGrams(item: CartItem & { variant: ProductVariant & { product: any } }) {
  return item.quantity * Number(item.variant.weightGrams ?? 500);
}

function vendorOriginState(vendor: Vendor | undefined): string {
  return String(vendor?.state ?? '').trim();
}

function toCouponLines(
  items: (CartItem & { variant: ProductVariant & { product: any } })[],
): CartLineForCoupon[] {
  return items.map((item) => {
    const product = item.variant.product;
    return {
      productId: String(product.id),
      categoryId: product.categoryId ? String(product.categoryId) : null,
      vendorId: product.vendorId ? String(product.vendorId) : null,
      unitPrice: Number(item.variant.price),
      quantity: Number(item.quantity),
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

type LineRateMap = Record<string, { gstPercentage: number; commissionRatePercent: number }>;

async function resolveItemLineRates(
  items: (CartItem & { variant: ProductVariant & { product: any } })[],
  vendor: Vendor | undefined,
  defaultCommissionRate: number,
): Promise<{ lineRates: LineRateMap; fallbackGst: number; fallbackCommission: number }> {
  const lineRates: LineRateMap = {};
  for (const item of items) {
    const categoryId = item.variant.product.categoryId;
    const gstPercentage = await taxService.getGstRate(categoryId);
    const commissionRatePercent = await categoriesService.resolveCommissionRate(
      categoryId,
      vendor?.commissionRate,
      defaultCommissionRate,
    );
    lineRates[item.id] = { gstPercentage, commissionRatePercent };
  }
  const first = items[0] ? lineRates[items[0].id] : undefined;
  return {
    lineRates,
    fallbackGst: first?.gstPercentage ?? 0,
    fallbackCommission: first?.commissionRatePercent ?? defaultCommissionRate,
  };
}

export class CheckoutService {
  async getQuote(userId: string, data: CheckoutQuoteRequest): Promise<{
    vendorBreakdowns: Array<{
      vendorId: string;
      vendor: { id: string; businessName: string; slug: string; logoUrl: string | null };
      items: Array<{ id: string; variantId: string; productName: string; quantity: number; unitPrice: number }>;
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
    cashbackAmount: number;
    walletBalance: number;
    walletAmountToUse: number;
    amountDue: number;
    appliedCoupon: { code: string; discount: number; cashbackAmount?: number } | null;
    appliedCoupons: Array<{ code: string; discount: number; cashbackAmount?: number }>;
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

    const itemsByVendor = groupBy(quoteCart.items, (item) => item.variant.product.vendorId || 'platform');
    const vendorIds = Object.keys(itemsByVendor).filter((id) => id !== 'platform');
    const vendors = vendorIds.length
      ? await Vendor.findAll({ where: { id: vendorIds } })
      : [];
    const vendorMap = Object.fromEntries(vendors.map((v) => [v.id, v]));
    const settings = await settingsService.getPlatformSettings();

    const shippingByVendor: Record<string, number> = {};
    const baseVendorRows: Array<{
      vendorId: string;
      items: (CartItem & { variant: ProductVariant & { product: any } })[];
      shippingCost: number;
      gstPercentage: number;
      commissionRate: number;
      lineRates: LineRateMap;
    }> = [];

    for (const [vendorId, items] of Object.entries(itemsByVendor)) {
      const subtotal = items.reduce(
        (sum, item) => sum + Number(item.variant.price) * item.quantity,
        0,
      );
      const vendor = vendorMap[vendorId];
      const method = requestedMethod(data.shippingMethodByVendor[vendorId]);
      const rates = await getRatesForQuote({
        pincode: shippingAddress.pincode,
        state: shippingAddress.state,
        weightGrams: items.reduce((sum, item) => sum + lineWeightGrams(item), 0),
        method,
      });
      const rate = rates.find((candidate) => candidate.method === method);
      if (!rate) throw new ValidationError(`No ${method} shipping rate is available`);
      const shippingCost =
        rate.freeShippingThreshold != null && subtotal >= rate.freeShippingThreshold
          ? 0
          : rate.cost;
      shippingByVendor[vendorId] = shippingCost;
      const resolved = await resolveItemLineRates(items, vendor, settings.defaultCommissionRate);
      baseVendorRows.push({
        vendorId,
        items,
        shippingCost,
        gstPercentage: resolved.fallbackGst,
        commissionRate: resolved.fallbackCommission,
        lineRates: resolved.lineRates,
      });
    }

    const shippingTotal = Object.values(shippingByVendor).reduce((s, n) => s + n, 0);
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
      appliedCoupons = result.coupons.map((coupon) => ({
        code: coupon.code,
        discount: result.discount,
        cashbackAmount: result.cashbackAmount,
      }));
      if (result.primaryCoupon) {
        applied = {
          code: result.coupons.map((c) => c.code).join('+'),
          discount,
          cashbackAmount,
        };
      }
    }

    const vendorBreakdowns = baseVendorRows.map((row) => {
      const vendor = vendorMap[row.vendorId];
      const merchandiseDiscount = vendorDiscountShares[row.vendorId] ?? 0;
      const shippingDiscount = vendorShippingDiscountShares[row.vendorId] ?? 0;
      const vendorBorne = vendorBorneDiscountShares[row.vendorId] ?? 0;
      const bearer = resolveVendorDiscountBearer(vendorBorne, merchandiseDiscount);
      const priced = pricingService.computeVendorBreakdown({
        lines: row.items.map((item) => ({
          key: item.id,
          unitPrice: Number(item.variant.price),
          quantity: Number(item.quantity),
          gstPercentage: row.lineRates[item.id]?.gstPercentage,
          commissionRatePercent: row.lineRates[item.id]?.commissionRatePercent,
        })),
        merchandiseDiscount,
        vendorBorneMerchandiseDiscount: vendorBorne,
        shippingDiscount,
        shippingCost: row.shippingCost,
        gstPercentage: row.gstPercentage,
        vendorStateCode: vendorOriginState(vendor),
        shippingStateCode: shippingAddress.state,
        commissionRatePercent: row.commissionRate,
        discountBearer: bearer,
        tcsRatePercent: settings.tcsRatePercent,
      });
      const r = priced.rupees;
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
        items: row.items.map((item) => ({
          id: item.id,
          variantId: item.variantId,
          productName: item.variant.product.name,
          quantity: item.quantity,
          unitPrice: Number(item.variant.price),
        })),
        subtotal: r.subtotal,
        shippingCost: r.shippingCharged,
        tax: {
          cgst: r.tax.cgst,
          sgst: r.tax.sgst,
          igst: r.tax.igst,
          total: r.tax.total,
        },
        discount: r.merchandiseDiscount + r.shippingDiscount,
        tcsAmount: r.tcsAmount,
        commissionAmount: r.commissionAmount,
        netPayout: r.netPayout,
        total: r.customerTotal,
      };
    });

    const grandTotal = vendorBreakdowns.reduce((sum, row) => sum + row.total, 0);
    const walletBalance = await walletService.getBalance(userId);
    const walletAmountToUse = Math.min(
      Math.max(0, Number(data.walletAmountToUse ?? 0)),
      walletBalance,
      grandTotal,
    );
    const amountDue = Math.round((grandTotal - walletAmountToUse) * 100) / 100;

    return {
      vendorBreakdowns,
      grandTotal,
      cashbackAmount,
      walletBalance,
      walletAmountToUse,
      amountDue,
      appliedCoupon: applied,
      appliedCoupons,
    };
  }

  async createOrderFromCart(
    userId: string,
    data: CreateCheckoutRequest,
  ): Promise<{ orderId: string; razorpayOrderId?: string; amount?: number; currency?: string; keyId?: string }> {
    const order = await sequelize.transaction(async (t) => {
      const cart = await loadUserCart(userId, t);

      assertCartItemsAvailable(cart);

      const shippingAddress = await Address.findOne({
        where: { id: data.shippingAddressId, userId },
        transaction: t,
      });

      if (!shippingAddress) {
        throw new NotFoundError('Shipping address');
      }

      const itemsByVendor = groupBy(cart.items, (item) => item.variant.product.vendorId || 'platform');
      const vendorIds = Object.keys(itemsByVendor).filter((id) => id !== 'platform');
      const vendors = vendorIds.length ? await Vendor.findAll({ where: { id: vendorIds }, transaction: t }) : [];
      const vendorMap = Object.fromEntries(vendors.map((vendor) => [vendor.id, vendor]));
      const settings = await settingsService.getPlatformSettings();
      let shippingTotal = 0;
      const shippingByVendor: Record<string, number> = {};
      const vendorPrep: Record<
        string,
        {
          items: (CartItem & { variant: ProductVariant & { product: any } })[];
          shippingCost: number;
          gstPercentage: number;
          commissionRate: number;
          lineRates: LineRateMap;
        }
      > = {};

      for (const [vendorId, items] of Object.entries(itemsByVendor)) {
        const method = requestedMethod(data.shippingMethodByVendor[vendorId]);
        const vendorSubtotal = items.reduce(
          (sum, item) => sum + Number(item.variant.price) * item.quantity,
          0,
        );
        const rates = await getRatesForQuote({
          pincode: shippingAddress.pincode,
          state: shippingAddress.state,
          weightGrams: items.reduce((sum, item) => sum + lineWeightGrams(item), 0),
          method,
        });
        const rate = rates.find((candidate) => candidate.method === method);
        if (!rate) throw new ValidationError(`No ${method} shipping rate is available`);
        const shippingCost =
          rate.freeShippingThreshold != null && vendorSubtotal >= rate.freeShippingThreshold
            ? 0
            : rate.cost;
        const vendor = vendorMap[vendorId];
        const resolved = await resolveItemLineRates(items, vendor, settings.defaultCommissionRate);
        shippingByVendor[vendorId] = shippingCost;
        shippingTotal += shippingCost;
        vendorPrep[vendorId] = {
          items,
          shippingCost,
          gstPercentage: resolved.fallbackGst,
          commissionRate: resolved.fallbackCommission,
          lineRates: resolved.lineRates,
        };
      }

      const couponCodes = resolveCheckoutCouponCodes(data, cart);
      let discountTotal = 0;
      let cashbackAmount = 0;
      let cashbackDiscountBearer: 'PLATFORM' | 'VENDOR' | null = null;
      let coupons: Coupon[] = [];
      let primaryCoupon: Coupon | null = null;
      let vendorDiscountShares: Record<string, number> = {};
      let vendorShippingDiscountShares: Record<string, number> = {};
      let vendorBorneDiscountShares: Record<string, number> = {};

      if (couponCodes.length > 0) {
        const result = await validateCouponSet({
          codes: couponCodes,
          userId,
          lines: toCouponLines(cart.items),
          shippingTotal,
          shippingByVendor,
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
        const cashbackCoupon = coupons.find((c) => c.type === 'CASHBACK');
        if (cashbackCoupon) {
          cashbackDiscountBearer =
            cashbackCoupon.discountBearer === DISCOUNT_BEARER.VENDOR
              ? DISCOUNT_BEARER.VENDOR
              : DISCOUNT_BEARER.PLATFORM;
        }
      }

      let customerGrandTotalPaise = 0;
      const pricedByVendor: Record<
        string,
        ReturnType<typeof pricingService.computeVendorBreakdown>
      > = {};
      const bearerByVendor: Record<string, (typeof DISCOUNT_BEARER)[keyof typeof DISCOUNT_BEARER]> = {};

      for (const [vendorId, prep] of Object.entries(vendorPrep)) {
        const merchandiseDiscount = vendorDiscountShares[vendorId] ?? 0;
        const shippingDiscount = vendorShippingDiscountShares[vendorId] ?? 0;
        const vendorBorne = vendorBorneDiscountShares[vendorId] ?? 0;
        const bearer = resolveVendorDiscountBearer(vendorBorne, merchandiseDiscount);
        bearerByVendor[vendorId] = bearer;
        const priced = pricingService.computeVendorBreakdown({
          lines: prep.items.map((item) => ({
            key: item.id,
            unitPrice: Number(item.variant.price),
            quantity: Number(item.quantity),
            gstPercentage: prep.lineRates[item.id]?.gstPercentage,
            commissionRatePercent: prep.lineRates[item.id]?.commissionRatePercent,
          })),
          merchandiseDiscount,
          vendorBorneMerchandiseDiscount: vendorBorne,
          shippingDiscount,
          shippingCost: prep.shippingCost,
          gstPercentage: prep.gstPercentage,
          vendorStateCode: vendorOriginState(vendorMap[vendorId]),
          shippingStateCode: shippingAddress.state,
          commissionRatePercent: prep.commissionRate,
          discountBearer: bearer,
          tcsRatePercent: settings.tcsRatePercent,
        });
        pricedByVendor[vendorId] = priced;
        customerGrandTotalPaise += priced.paise.customerTotalPaise;
      }

      const orderTotalRupees = fromPaise(customerGrandTotalPaise);
      const requestedWallet = Math.max(0, Number(data.walletAmountToUse ?? 0));
      let walletAmountUsed = 0;
      if (requestedWallet > 0) {
        if (data.paymentMethod === PAYMENT_METHOD.COD) {
          throw new ValidationError(ERROR_MESSAGES.WALLET_INVALID_AMOUNT);
        }
        const balance = await walletService.getBalance(userId, t);
        walletAmountUsed = Math.min(requestedWallet, balance, orderTotalRupees);
        walletAmountUsed = Math.round(walletAmountUsed * 100) / 100;
      }
      const razorpayRemainder = Math.round((orderTotalRupees - walletAmountUsed) * 100) / 100;

      const orderRow = await Order.create({
        userId,
        shippingAddressId: data.shippingAddressId,
        couponId: primaryCoupon?.id ?? null,
        appliedCouponIds: coupons.map((c) => c.id),
        totalAmount: orderTotalRupees,
        discountTotal,
        status: ORDER_STATUS.PENDING,
        paymentStatus: PAYMENT_STATUS.PENDING,
        paymentMethod: data.paymentMethod,
        walletAmountUsed,
        pendingCashbackAmount: cashbackAmount,
        cashbackCreditedAt: null,
        cashbackDiscountBearer,
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
      if (data.paymentMethod === PAYMENT_METHOD.RAZORPAY && razorpayRemainder <= 0) {
        await orderRow.update(
          {
            paymentStatus: PAYMENT_STATUS.PAID,
            status: ORDER_STATUS.CONFIRMED,
          },
          { transaction: t },
        );
        if (coupons.length > 0) {
          const perCouponDiscount =
            coupons.length > 0 ? discountTotal / coupons.length : 0;
          for (const coupon of coupons) {
            await recordCouponUsage({
              couponId: coupon.id,
              userId,
              orderId: orderRow.id,
              discountApplied: perCouponDiscount,
              actorId: userId,
              transaction: t,
            });
          }
        }
      }

      for (const [vendorId, prep] of Object.entries(vendorPrep)) {
        const priced = pricedByVendor[vendorId]!;
        const r = priced.rupees;
        const p = priced.paise;
        const bearer = bearerByVendor[vendorId] ?? DISCOUNT_BEARER.PLATFORM;

        const subOrder = await SubOrder.create({
          orderId: orderRow.id,
          vendorId: vendorId === 'platform' ? null : vendorId,
          status: ORDER_STATUS.PENDING,
          subtotal: r.subtotal,
          shippingCost: r.shippingCost,
          shippingDiscountAmount: r.shippingDiscount,
          taxAmount: r.tax.total,
          taxableAmount: r.taxableAmount,
          taxBreakdown: r.tax,
          discountAmount: r.merchandiseDiscount,
          commissionAmount: r.commissionAmount,
          tcsAmount: r.tcsAmount,
          netPayoutAmount: r.netPayout,
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
          trackingId: null,
        }, { transaction: t });

        const lineByKey = Object.fromEntries(
          priced.paise.lines.map((row) => [row.key, row]),
        );
        const lineRupeesByKey = Object.fromEntries(
          priced.rupees.lines.map((row) => [row.key, row]),
        );

        for (const item of prep.items) {
          const linePaise = lineByKey[item.id]!;
          const lineRupees = lineRupeesByKey[item.id]!;
          await OrderItem.create({
            subOrderId: subOrder.id,
            variantId: item.variantId,
            productName: item.variant.product.name,
            quantity: item.quantity,
            unitPrice: Number(item.variant.price),
            discountAmount: lineRupees.discountAmount,
            taxableAmount: lineRupees.taxableAmount,
            taxAmount: lineRupees.tax.total,
            taxBreakdown: lineRupees.tax,
            commissionAmount: lineRupees.commissionAmount,
            tcsAmount: lineRupees.tcsAmount,
            netPayoutAmount: lineRupees.netPayout,
            unitPricePaise: linePaise.unitPricePaise,
            discountAmountPaise: linePaise.discountPaise,
            taxableAmountPaise: linePaise.taxablePaise,
            taxAmountPaise: linePaise.tax.total,
            commissionAmountPaise: linePaise.commissionPaise,
            tcsAmountPaise: linePaise.tcsPaise,
            netPayoutAmountPaise: linePaise.netPayoutPaise,
          }, { transaction: t });

          await item.variant.decrement('stock', {
            by: item.quantity,
            transaction: t,
          });
        }

        if (vendorId !== 'platform') {
          await CommissionLedger.create({
            vendorId,
            subOrderId: subOrder.id,
            saleAmount: r.commissionBase,
            commissionRate:
              p.commissionBasePaise > 0
                ? Math.round((p.commissionPaise / p.commissionBasePaise) * 10000) / 100
                : prep.commissionRate,
            commissionAmount: r.commissionAmount,
            taxableAmount: r.taxableAmount,
            discountAmount: r.merchandiseDiscount,
            discountBearer: bearer,
            taxAmount: r.tax.total,
            tcsAmount: r.tcsAmount,
            netPayoutAmount: r.netPayout,
            shippingCollected: r.shippingCharged,
            saleAmountPaise: p.commissionBasePaise,
            commissionAmountPaise: p.commissionPaise,
            taxableAmountPaise: p.taxablePaise,
            discountAmountPaise: p.merchandiseDiscountPaise,
            taxAmountPaise: p.tax.total,
            tcsAmountPaise: p.tcsPaise,
            netPayoutAmountPaise: p.netPayoutPaise,
            shippingCollectedPaise: p.shippingChargedPaise,
            status: COMMISSION_STATUS.PENDING,
          }, { transaction: t });

          if (p.tcsPaise > 0) {
            await TcsLedger.create({
              orderId: orderRow.id,
              subOrderId: subOrder.id,
              vendorId,
              taxableAmountPaise: p.taxablePaise,
              ratePercent: settings.tcsRatePercent,
              tcsAmountPaise: p.tcsPaise,
              createdBy: userId,
              updatedBy: userId,
              deletedBy: null,
            }, { transaction: t });
          }
        }
      }

      // Usage is webhook-driven for Razorpay. COD has no webhook — record on place.
      if (coupons.length > 0 && data.paymentMethod === PAYMENT_METHOD.COD) {
        const perCouponDiscount =
          coupons.length > 0 ? discountTotal / coupons.length : 0;
        for (const coupon of coupons) {
          await recordCouponUsage({
            couponId: coupon.id,
            userId,
            orderId: orderRow.id,
            discountApplied: perCouponDiscount,
            actorId: userId,
            transaction: t,
          });
        }
      }

      await cart.update({ couponCode: null, couponCodes: [] }, { transaction: t });

      await CartItem.destroy({
        where: { cartId: cart.id },
        transaction: t,
      });

      return orderRow;
    });

    if (data.paymentMethod === PAYMENT_METHOD.RAZORPAY) {
      const walletUsed = Number(order.walletAmountUsed ?? 0);
      const remainder = Math.round((Number(order.totalAmount) - walletUsed) * 100) / 100;
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
    return sequelize.transaction(async (t) => {
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
        throw new ValidationError('Paid orders cannot be cancelled from checkout');
      }
      if (locked.status === ORDER_STATUS.CANCELLED) {
        return { restored: false, orderId: locked.id };
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
      }

      await cartService.restoreItemsToUserCart(userId, restoreLines, t);

      const walletUsed = Number(order.walletAmountUsed ?? 0);
      if (walletUsed > 0) {
        await walletService.credit(
          userId,
          walletUsed,
          { type: WALLET_REFERENCE_TYPE.ORDER, id: order.id },
          `${WALLET_DESCRIPTIONS.CHECKOUT_SPEND} rollback`,
          t,
        );
      }

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
  }
}

export const checkoutService = new CheckoutService();

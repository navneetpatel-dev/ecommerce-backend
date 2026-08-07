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
  validateCoupon,
  commissionSaleAmount,
  recordCouponUsage,
  creditCashbackIfNeeded,
  resolveDiscountBearer,
  type CartLineForCoupon,
} from '@modules/coupons/couponEngine';
import { resolveItemAvailability } from '@core/catalog/customerVisibility';
import type {
  CancelCheckoutRequest,
  CreateCheckoutRequest,
  CheckoutQuoteRequest,
} from './checkout.dto';
import {
  ORDER_STATUS,
  PAYMENT_STATUS,
  PAYMENT_METHOD,
  COMMISSION_STATUS,
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
      total: number;
    }>;
    grandTotal: number;
    appliedCoupon: { code: string; discount: number; cashbackAmount?: number } | null;
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

    const vendorBreakdowns = await Promise.all(Object.entries(itemsByVendor).map(async ([vendorId, items]) => {
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
      const shippingCost = rate.freeShippingThreshold != null && subtotal >= rate.freeShippingThreshold
        ? 0
        : rate.cost;
      const categoryId = items[0]!.variant.product.categoryId;
      const gstPercentage = await taxService.getGstRate(categoryId);
      const tax = taxService.calculateTax({
        vendorStateCode: vendorOriginState(vendor),
        shippingStateCode: shippingAddress.state,
        taxableAmount: subtotal,
        gstPercentage,
      });
      return {
        vendorId,
        vendor: vendor
          ? {
              id: vendor.id,
              businessName: vendor.businessName,
              slug: vendor.slug,
              logoUrl: vendor.logoUrl ?? null,
            }
          : { id: vendorId, businessName: 'Marketplace', slug: 'platform', logoUrl: null },
        items: items.map((item) => ({
          id: item.id,
          variantId: item.variantId,
          productName: item.variant.product.name,
          quantity: item.quantity,
          unitPrice: Number(item.variant.price),
        })),
        subtotal,
        shippingCost,
        tax: { cgst: tax.cgst, sgst: tax.sgst, igst: tax.igst, total: tax.total },
        discount: 0,
        total: subtotal + shippingCost + tax.total,
      };
    }));
    const subtotal = vendorBreakdowns.reduce((sum, breakdown) => sum + breakdown.subtotal, 0);
    const shippingTotal = vendorBreakdowns.reduce((sum, breakdown) => sum + breakdown.shippingCost, 0);
    const taxTotal = vendorBreakdowns.reduce((sum, breakdown) => sum + breakdown.tax.total, 0);
    const shippingByVendor = Object.fromEntries(
      vendorBreakdowns.map((b) => [b.vendorId, b.shippingCost]),
    );

    const couponCode = data.couponCode ?? cart.couponCode ?? undefined;
    let discount = 0;
    let cashbackAmount = 0;
    let applied: { code: string; discount: number; cashbackAmount?: number } | null = null;

    if (couponCode) {
      const result = await validateCoupon({
        code: couponCode,
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
      for (const breakdown of vendorBreakdowns) {
        const share = result.vendorDiscountShares[breakdown.vendorId] ?? 0;
        breakdown.discount = share;
        breakdown.total = Math.max(0, breakdown.total - share);
      }
      if (result.coupon) {
        applied = { code: result.coupon.code, discount, cashbackAmount };
      }
    }

    return {
      vendorBreakdowns,
      grandTotal: Math.max(0, subtotal + shippingTotal + taxTotal - discount),
      appliedCoupon: applied,
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

      let subtotal = 0;
      for (const item of cart.items) {
        subtotal += Number(item.variant.price) * item.quantity;
      }

      const itemsByVendor = groupBy(cart.items, (item) => item.variant.product.vendorId || 'platform');
      const vendorIds = Object.keys(itemsByVendor).filter((id) => id !== 'platform');
      const vendors = vendorIds.length ? await Vendor.findAll({ where: { id: vendorIds }, transaction: t }) : [];
      const vendorMap = Object.fromEntries(vendors.map((vendor) => [vendor.id, vendor]));
      const settings = await settingsService.getPlatformSettings();
      const vendorCharges: Record<string, { shippingCost: number; taxAmount: number; subtotal: number }> = {};
      let shippingTotal = 0;
      let taxTotal = 0;
      for (const [vendorId, items] of Object.entries(itemsByVendor)) {
        const method = requestedMethod(data.shippingMethodByVendor[vendorId]);
        const vendorSubtotal = items.reduce((sum, item) => sum + Number(item.variant.price) * item.quantity, 0);
        const rates = await getRatesForQuote({
          pincode: shippingAddress.pincode,
          state: shippingAddress.state,
          weightGrams: items.reduce((sum, item) => sum + lineWeightGrams(item), 0),
          method,
        });
        const rate = rates.find((candidate) => candidate.method === method);
        if (!rate) throw new ValidationError(`No ${method} shipping rate is available`);
        const shippingCost = rate.freeShippingThreshold != null && vendorSubtotal >= rate.freeShippingThreshold
          ? 0
          : rate.cost;
        const gstPercentage = await taxService.getGstRate(items[0]!.variant.product.categoryId);
        const taxAmount = taxService.calculateTax({
          vendorStateCode: vendorOriginState(vendorMap[vendorId]),
          shippingStateCode: shippingAddress.state,
          taxableAmount: vendorSubtotal,
          gstPercentage,
        }).total;
        vendorCharges[vendorId] = { shippingCost, taxAmount, subtotal: vendorSubtotal };
        shippingTotal += shippingCost;
        taxTotal += taxAmount;
      }

      const couponCode = data.couponCode ?? cart.couponCode ?? undefined;
      const shippingByVendor = Object.fromEntries(
        Object.entries(vendorCharges).map(([id, c]) => [id, c.shippingCost]),
      );
      let discountTotal = 0;
      let cashbackAmount = 0;
      let coupon = null as Awaited<ReturnType<typeof validateCoupon>>['coupon'];
      let vendorDiscountShares: Record<string, number> = {};

      if (couponCode) {
        const result = await validateCoupon({
          code: couponCode,
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
        coupon = result.coupon;
        vendorDiscountShares = result.vendorDiscountShares;
      }

      const orderRow = await Order.create({
        userId,
        shippingAddressId: data.shippingAddressId,
        couponId: coupon?.id ?? null,
        totalAmount: subtotal + shippingTotal + taxTotal - discountTotal,
        discountTotal,
        status: ORDER_STATUS.PENDING,
        paymentStatus: PAYMENT_STATUS.PENDING,
        razorpayOrderId: null,
        razorpayPaymentId: null,
      }, { transaction: t });

      const bearer = resolveDiscountBearer(coupon);

      for (const [vendorId, items] of Object.entries(itemsByVendor)) {
        const charges = vendorCharges[vendorId]!;
        const subOrderTotal = charges.subtotal;
        const discountAmount = vendorDiscountShares[vendorId] ?? 0;

        const vendor = vendorMap[vendorId];
        const categoryId = items[0]!.variant.product.categoryId;
        const commissionRate = await categoriesService.resolveCommissionRate(
          categoryId,
          vendor?.commissionRate,
          settings.defaultCommissionRate,
        );
        const saleAmount = commissionSaleAmount(subOrderTotal, discountAmount, bearer);
        const commissionAmount = saleAmount * (commissionRate / 100);

        const subOrder = await SubOrder.create({
          orderId: orderRow.id,
          vendorId: vendorId === 'platform' ? null : vendorId,
          status: ORDER_STATUS.PENDING,
          subtotal: subOrderTotal,
          shippingCost: charges.shippingCost,
          taxAmount: charges.taxAmount,
          discountAmount,
          commissionAmount,
          trackingId: null,
        }, { transaction: t });

        for (const item of items) {
          await OrderItem.create({
            subOrderId: subOrder.id,
            variantId: item.variantId,
            productName: item.variant.product.name,
            quantity: item.quantity,
            unitPrice: Number(item.variant.price),
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
            saleAmount,
            commissionRate,
            commissionAmount,
            status: COMMISSION_STATUS.PENDING,
          }, { transaction: t });
        }
      }

      // Usage is webhook-driven for Razorpay. COD has no webhook — record on place.
      if (coupon && data.paymentMethod === PAYMENT_METHOD.COD) {
        await recordCouponUsage({
          couponId: coupon.id,
          userId,
          orderId: orderRow.id,
          discountApplied: discountTotal,
          actorId: userId,
          transaction: t,
        });
        if (cashbackAmount > 0) {
          await creditCashbackIfNeeded({
            coupon,
            userId,
            orderId: orderRow.id,
            cashbackAmount,
            transaction: t,
          });
        }
      }

      await cart.update({ couponCode: null }, { transaction: t });

      await CartItem.destroy({
        where: { cartId: cart.id },
        transaction: t,
      });

      return orderRow;
    });

    if (data.paymentMethod === PAYMENT_METHOD.RAZORPAY) {
      const razorpay = await paymentsService.createRazorpayOrderForOrder(order);
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

      await order.update(
        {
          status: ORDER_STATUS.CANCELLED,
          paymentStatus: PAYMENT_STATUS.FAILED,
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

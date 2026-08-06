import { NotFoundError } from '@core/errors/NotFoundError';
import { ValidationError } from '@core/errors/ValidationError';
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
import type { CreateCheckoutRequest, CheckoutQuoteRequest } from './checkout.dto';

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

async function loadUserCart(userId: string, transaction?: any): Promise<CartWithItems> {
  const cartResult = await Cart.findOne({
    where: { userId },
    include: [{
      model: CartItem,
      as: 'items',
      include: [{
        model: ProductVariant,
        as: 'variant',
        include: ['product'],
      }],
    }],
    transaction,
  });

  if (!cartResult) {
    throw new ValidationError('Cart is empty');
  }

  const cart = cartResult as CartWithItems;
  if (!cart.items || cart.items.length === 0) {
    throw new ValidationError('Cart is empty');
  }

  return cart;
}

function shippingCostForMethod(method?: string): number {
  const normalized = (method || 'STANDARD').toUpperCase();
  return normalized === 'EXPRESS' ? 100 : 50;
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
    appliedCoupon: { code: string; discount: number } | null;
  }> {
    const cart = await loadUserCart(userId);

    const shippingAddress = await Address.findOne({
      where: { id: data.shippingAddressId, userId },
    });
    if (!shippingAddress) {
      throw new NotFoundError('Shipping address');
    }

    const itemsByVendor = groupBy(cart.items, (item) => item.variant.product.vendorId || 'platform');
    const vendorIds = Object.keys(itemsByVendor).filter((id) => id !== 'platform');
    const vendors = vendorIds.length
      ? await Vendor.findAll({ where: { id: vendorIds } })
      : [];
    const vendorMap = Object.fromEntries(vendors.map((v) => [v.id, v]));

    let grandTotal = 0;
    const vendorBreakdowns = Object.entries(itemsByVendor).map(([vendorId, items]) => {
      const subtotal = items.reduce(
        (sum, item) => sum + Number(item.variant.price) * item.quantity,
        0,
      );
      const shippingCost = shippingCostForMethod(data.shippingMethodByVendor[vendorId]);
      const total = subtotal + shippingCost;
      grandTotal += total;

      const vendor = vendorMap[vendorId];
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
        tax: { cgst: 0, sgst: 0, igst: 0, total: 0 },
        discount: 0,
        total,
      };
    });

    return {
      vendorBreakdowns,
      grandTotal,
      appliedCoupon: null as { code: string; discount: number } | null,
    };
  }

  async createOrderFromCart(
    userId: string,
    data: CreateCheckoutRequest,
  ): Promise<{ orderId: string; razorpayOrderId?: string; amount?: number; currency?: string; keyId?: string }> {
    const order = await sequelize.transaction(async (t) => {
      const cart = await loadUserCart(userId, t);

      const shippingAddress = await Address.findOne({
        where: { id: data.shippingAddressId, userId },
        transaction: t,
      });

      if (!shippingAddress) {
        throw new NotFoundError('Shipping address');
      }

      let subtotal = 0;
      for (const item of cart.items) {
        if (item.variant.stock < item.quantity) {
          throw new ValidationError(`Insufficient stock for ${item.variant.product.name}`);
        }
        subtotal += Number(item.variant.price) * item.quantity;
      }

      // Shipping (server-side; never trust client amounts)
      const itemsByVendor = groupBy(cart.items, (item) => item.variant.product.vendorId || 'platform');
      let shippingTotal = 0;
      for (const vendorId of Object.keys(itemsByVendor)) {
        shippingTotal += shippingCostForMethod(data.shippingMethodByVendor[vendorId]);
      }

      // Coupon integration pending
      const discountTotal = 0;
      const couponId = null;

      const orderRow = await Order.create({
        userId,
        shippingAddressId: data.shippingAddressId,
        couponId,
        totalAmount: subtotal + shippingTotal - discountTotal,
        discountTotal,
        status: 'PENDING',
        paymentStatus: 'PENDING',
        razorpayOrderId: null,
        razorpayPaymentId: null,
      }, { transaction: t });

      for (const [vendorId, items] of Object.entries(itemsByVendor)) {
        const subOrderTotal = items.reduce(
          (sum, item) => sum + Number(item.variant.price) * item.quantity,
          0,
        );

        const commissionRate = 10.0;
        const commissionAmount = subOrderTotal * (commissionRate / 100);

        const subOrder = await SubOrder.create({
          orderId: orderRow.id,
          vendorId: vendorId === 'platform' ? null : vendorId,
          status: 'PENDING',
          subtotal: subOrderTotal,
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
            saleAmount: subOrderTotal,
            commissionRate,
            commissionAmount,
            status: 'PENDING',
          }, { transaction: t });
        }
      }

      await CartItem.destroy({
        where: { cartId: cart.id },
        transaction: t,
      });

      return orderRow;
    });

    if (data.paymentMethod === 'RAZORPAY') {
      const razorpay = await paymentsService.createRazorpayOrderForOrder(order);
      return {
        orderId: order.id,
        ...razorpay,
      };
    }

    // COD / wallet / mixed — no Razorpay order; paymentStatus stays PENDING until fulfilled elsewhere
    return { orderId: order.id };
  }
}

export const checkoutService = new CheckoutService();

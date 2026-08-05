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
import { sequelize } from '@database/models';
import type { CreateCheckoutRequest } from './checkout.dto';

function groupBy<T>(array: T[], keyFn: (item: T) => string): Record<string, T[]> {
  return array.reduce((acc, item) => {
    const key = keyFn(item);
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {} as Record<string, T[]>);
}

export class CheckoutService {
  async createOrderFromCart(userId: string, data: CreateCheckoutRequest) {
    return sequelize.transaction(async (t) => {
      // get user cart with items
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
        transaction: t,
      });

      if (!cartResult) {
        throw new ValidationError('Cart is empty');
      }

      // type cast after null check
      const cart = cartResult as Cart & { items: (CartItem & { variant: ProductVariant & { product: any } })[] };

      if (!cart.items || cart.items.length === 0) {
        throw new ValidationError('Cart is empty');
      }

      // verify shipping address
      const shippingAddress = await Address.findOne({
        where: { id: data.shippingAddressId, userId },
        transaction: t,
      });

      if (!shippingAddress) {
        throw new NotFoundError('Shipping address');
      }

      // calculate subtotal and check stock
      let subtotal = 0;
      for (const item of cart.items) {
        if (item.variant.stock < item.quantity) {
          throw new ValidationError(`Insufficient stock for ${item.variant.product.name}`);
        }
        subtotal += Number(item.variant.price) * item.quantity;
      }

      // apply coupon if provided (TODO: coupon integration pending)
      let discountTotal = 0;
      let couponId = null;

      // split cart items by vendor
      const itemsByVendor = groupBy(cart.items, (item) => item.variant.product.vendorId || 'platform');

      // create main order
      const order = await Order.create({
        userId,
        shippingAddressId: data.shippingAddressId,
        couponId,
        totalAmount: subtotal - discountTotal,
        discountTotal,
        status: 'PENDING',
        paymentStatus: 'PENDING',
        razorpayOrderId: null,
        razorpayPaymentId: null,
      }, { transaction: t });

      // create sub-orders per vendor
      for (const [vendorId, items] of Object.entries(itemsByVendor)) {
        const subOrderTotal = items.reduce(
          (sum, item) => sum + Number(item.variant.price) * item.quantity,
          0
        );

        // commission rate is 10% as per requirements
        const commissionRate = 10.0;
        const commissionAmount = subOrderTotal * (commissionRate / 100);

        const subOrder = await SubOrder.create({
          orderId: order.id,
          vendorId: vendorId === 'platform' ? null : vendorId,
          status: 'PENDING',
          subtotal: subOrderTotal,
          commissionAmount,
          trackingId: null,
        }, { transaction: t });

        // create order items and reduce stock
        for (const item of items) {
          await OrderItem.create({
            subOrderId: subOrder.id,
            variantId: item.variantId,
            productName: item.variant.product.name,
            quantity: item.quantity,
            unitPrice: Number(item.variant.price),
          }, { transaction: t });

          // reduce variant stock
          await item.variant.decrement('stock', {
            by: item.quantity,
            transaction: t,
          });
        }

        // create commission ledger entry for vendor
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

      // 10. Clear cart
      await CartItem.destroy({
        where: { cartId: cart.id },
        transaction: t,
      });

      // 11. Return order with sub-orders
      const createdOrder = await Order.findByPk(order.id, {
        include: ['subOrders', 'shippingAddress'],
        transaction: t,
      });

      return createdOrder;
    });
  }
}

export const checkoutService = new CheckoutService();

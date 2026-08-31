import { NotFoundError } from '@core/errors/NotFoundError';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { ValidationError } from '@core/errors/ValidationError';
import { buildPaginationMeta, paginationOffset } from '@core/http/pagination';
import { ordersRepository } from './orders.repository';
import { sequelize } from '@database/models';
import { OrderItem } from '@database/models/orderItem.model';
import { Vendor } from '@database/models/vendor.model';
import { Shipment } from '@database/models/shipment.model';
import { coerceRupees, roundMoney } from '@modules/pricing/money';
import {
  combinedDiscount,
  lineSubtotal,
  lineTotal,
  orderAmountDue,
  shippingCharged,
  subOrderCustomerTotal,
} from '@modules/pricing/displayMoney';
import type { CreateOrderRequest, GetOrdersQuery } from './orders.dto';

const orderDetailInclude = [
  {
    association: 'subOrders',
    include: [
      { model: Vendor, as: 'vendor' },
      { model: OrderItem, as: 'items' },
      { model: Shipment, as: 'shipment' },
    ],
  },
  { association: 'shippingAddress' },
];

function mapOrderItem(item: any) {
  const unitPrice = roundMoney(item.unitPrice);
  const quantity = Math.trunc(coerceRupees(item.quantity)) || 0;
  const taxableAmount = roundMoney(item.taxableAmount);
  const taxAmount = roundMoney(item.taxAmount);
  return {
    ...item,
    quantity,
    unitPrice,
    discountAmount: roundMoney(item.discountAmount),
    taxableAmount,
    taxAmount,
    commissionAmount: roundMoney(item.commissionAmount),
    tcsAmount: roundMoney(item.tcsAmount),
    netPayoutAmount: roundMoney(item.netPayoutAmount),
    lineSubtotal:
      item.lineSubtotal != null && item.lineSubtotal !== ''
        ? roundMoney(item.lineSubtotal)
        : lineSubtotal(unitPrice, quantity),
    lineTotal:
      item.lineTotal != null && item.lineTotal !== ''
        ? roundMoney(item.lineTotal)
        : lineTotal(taxableAmount, taxAmount),
  };
}

function mapSubOrder(sub: any) {
  const shippingCost = roundMoney(sub.shippingCost);
  const shippingDiscountAmount = roundMoney(sub.shippingDiscountAmount);
  const discountAmount = roundMoney(sub.discountAmount);
  const taxableAmount = roundMoney(sub.taxableAmount);
  const taxAmount = roundMoney(sub.taxAmount);
  return {
    ...sub,
    subtotal: roundMoney(sub.subtotal),
    shippingCost,
    shippingDiscountAmount,
    shippingCharged:
      sub.shippingCharged != null && sub.shippingCharged !== ''
        ? roundMoney(sub.shippingCharged)
        : shippingCharged(shippingCost, shippingDiscountAmount),
    taxAmount,
    taxableAmount,
    discountAmount,
    discountTotal: combinedDiscount(discountAmount, shippingDiscountAmount),
    commissionAmount: roundMoney(sub.commissionAmount),
    tcsAmount: roundMoney(sub.tcsAmount),
    netPayoutAmount: roundMoney(sub.netPayoutAmount),
    customerTotal: subOrderCustomerTotal({
      customerTotal: sub.customerTotal,
      taxableAmount,
      taxAmount,
      shippingCost,
      shippingDiscountAmount,
    }),
    items: (sub.items ?? []).map(mapOrderItem),
  };
}

function mapOrderResponse(order: any) {
  const plain = typeof order.get === 'function' ? order.get({ plain: true }) : order;
  const totalAmount = roundMoney(plain.totalAmount);
  const walletAmountUsed = roundMoney(plain.walletAmountUsed);
  const originalTotalAmount = roundMoney(plain.originalTotalAmount ?? totalAmount);
  const razorpayAmountPaid = roundMoney(
    plain.razorpayAmountPaid ?? Math.max(0, originalTotalAmount - walletAmountUsed),
  );
  const subOrders = (plain.subOrders ?? []).map(mapSubOrder);
  const merchandiseSubtotal =
    plain.merchandiseSubtotal != null && plain.merchandiseSubtotal !== ''
      ? roundMoney(plain.merchandiseSubtotal)
      : roundMoney(subOrders.reduce((sum: number, sub: { subtotal: number }) => sum + sub.subtotal, 0));
  const taxTotal =
    plain.taxTotal != null && plain.taxTotal !== ''
      ? roundMoney(plain.taxTotal)
      : roundMoney(subOrders.reduce((sum: number, sub: { taxAmount: number }) => sum + sub.taxAmount, 0));
  const shippingTotal =
    plain.shippingTotal != null && plain.shippingTotal !== ''
      ? roundMoney(plain.shippingTotal)
      : roundMoney(
          subOrders.reduce(
            (sum: number, sub: { shippingCharged: number }) => sum + sub.shippingCharged,
            0,
          ),
        );
  return {
    ...plain,
    totalAmount,
    discountTotal: roundMoney(plain.discountTotal),
    walletAmountUsed,
    originalTotalAmount,
    razorpayAmountPaid,
    amountDue: orderAmountDue({
      amountDue: plain.amountDue,
      paymentMethod: plain.paymentMethod,
      totalAmount,
      walletAmountUsed,
      razorpayAmountPaid,
    }),
    merchandiseSubtotal,
    taxTotal,
    shippingTotal,
    pendingCashbackAmount: roundMoney(plain.pendingCashbackAmount),
    cashbackCreditedAt: plain.cashbackCreditedAt ?? null,
    cashbackDiscountBearer: plain.cashbackDiscountBearer ?? null,
    paymentMethod: plain.paymentMethod ?? null,
    customerName: plain.user?.name ?? null,
    subOrders,
  };
}

export class OrdersService {
  async createOrder(userId: string, data: CreateOrderRequest) {
    void userId;
    void data;
    throw new ValidationError('Use /api/checkout to place orders');
  }

  async getOrders(userId: string | null, query: GetOrdersQuery) {
    const offset = paginationOffset(query.page, query.limit);
    const { rows, count } = await ordersRepository.findWithFilters({
      userId: userId ?? undefined,
      status: query.status,
      limit: query.limit,
      offset,
    });

    return {
      orders: rows.map(mapOrderResponse),
      pagination: buildPaginationMeta(count, query.page, query.limit),
    };
  }

  /**
   * Order history is intentionally UNSCOPED.
   * OrderItem.productName / unitPrice are frozen snapshots from checkout — later
   * vendor suspension or product unpublish must not hide or rewrite past purchases.
   */
  async getOrderById(id: string, userId?: string) {
    const order = await ordersRepository.findById(id, {
      include: orderDetailInclude,
    });
    if (!order) throw new NotFoundError('Order');
    if (userId && order.userId !== userId) {
      throw new ForbiddenError('You do not have access to this order');
    }
    return mapOrderResponse(order);
  }

  async updateOrderStatus(id: string, status: string) {
    return sequelize.transaction(async (t) => {
      const order = await ordersRepository.findById(id, { transaction: t });
      if (!order) throw new NotFoundError('Order');

      await ordersRepository.update(id, { status: status as any }, { transaction: t });
      return this.getOrderById(id);
    });
  }
}

export const ordersService = new OrdersService();

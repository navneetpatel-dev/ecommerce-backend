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
  return {
    ...item,
    quantity: Math.trunc(coerceRupees(item.quantity)) || 0,
    unitPrice: roundMoney(item.unitPrice),
    discountAmount: roundMoney(item.discountAmount),
    taxableAmount: roundMoney(item.taxableAmount),
    taxAmount: roundMoney(item.taxAmount),
    commissionAmount: roundMoney(item.commissionAmount),
    tcsAmount: roundMoney(item.tcsAmount),
    netPayoutAmount: roundMoney(item.netPayoutAmount),
  };
}

function mapSubOrder(sub: any) {
  return {
    ...sub,
    subtotal: roundMoney(sub.subtotal),
    shippingCost: roundMoney(sub.shippingCost),
    shippingDiscountAmount: roundMoney(sub.shippingDiscountAmount),
    taxAmount: roundMoney(sub.taxAmount),
    taxableAmount: roundMoney(sub.taxableAmount),
    discountAmount: roundMoney(sub.discountAmount),
    commissionAmount: roundMoney(sub.commissionAmount),
    tcsAmount: roundMoney(sub.tcsAmount),
    netPayoutAmount: roundMoney(sub.netPayoutAmount),
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
  return {
    ...plain,
    totalAmount,
    discountTotal: roundMoney(plain.discountTotal),
    walletAmountUsed,
    originalTotalAmount,
    razorpayAmountPaid,
    pendingCashbackAmount: roundMoney(plain.pendingCashbackAmount),
    cashbackCreditedAt: plain.cashbackCreditedAt ?? null,
    cashbackDiscountBearer: plain.cashbackDiscountBearer ?? null,
    paymentMethod: plain.paymentMethod ?? null,
    customerName: plain.user?.name ?? null,
    subOrders: (plain.subOrders ?? []).map(mapSubOrder),
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

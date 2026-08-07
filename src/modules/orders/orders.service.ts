import { NotFoundError } from '@core/errors/NotFoundError';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { ValidationError } from '@core/errors/ValidationError';
import { buildPaginationMeta, paginationOffset } from '@core/http/pagination';
import { ordersRepository } from './orders.repository';
import { sequelize } from '@database/models';
import { OrderItem } from '@database/models/orderItem.model';
import { Vendor } from '@database/models/vendor.model';
import { Shipment } from '@database/models/shipment.model';
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

function mapOrderResponse(order: any) {
  const plain = typeof order.get === 'function' ? order.get({ plain: true }) : order;
  return {
    ...plain,
    totalAmount: Number(plain.totalAmount ?? 0),
    discountTotal: Number(plain.discountTotal ?? 0),
    customerName: plain.user?.name ?? null,
    subOrders: (plain.subOrders ?? []).map((sub: any) => ({
      ...sub,
      subtotal: Number(sub.subtotal ?? 0),
      shippingCost: Number(sub.shippingCost ?? 0),
      taxAmount: Number(sub.taxAmount ?? 0),
      items: (sub.items ?? []).map((item: any) => ({
        ...item,
        unitPrice: Number(item.unitPrice ?? 0),
        quantity: Number(item.quantity ?? 0),
      })),
    })),
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

import { Order } from '@database/models/order.model';
import { SubOrder } from '@database/models/subOrder.model';
import { Shipment } from '@database/models/shipment.model';
import { ReturnRequest } from '@database/models/returnRequest.model';
import { OrderItem } from '@database/models/orderItem.model';
import { ProductVariant } from '@database/models/productVariant.model';
import { Product } from '@database/models/product.model';
import { Address } from '@database/models/address.model';
import { User } from '@database/models/user.model';
import { Vendor } from '@database/models/vendor.model';
import { fromPaise, roundMoney, toPaise } from '@modules/pricing/money';
import { isWalletFundedOrder, walletShareOfRefundPaise } from '@modules/pricing/refundSplit';
import { mapSubOrder } from '@modules/orders/orderDisplayMappers';
import { VENDOR_VISIBLE_ORDER_WHERE } from './subOrderTransitions';

export const shipmentInclude = {
  model: Shipment,
  as: 'shipment' as const,
};

export const returnRequestInclude = {
  model: ReturnRequest,
  as: 'returnRequests' as const,
};

export function suborderCancelCashShare(order: Order, customerRefund: number): number {
  if (isWalletFundedOrder(order)) return 0;
  const refundPaise = toPaise(customerRefund);
  return fromPaise(refundPaise - walletShareOfRefundPaise(order, refundPaise));
}

export function mapSubOrderRow(row: SubOrder) {
  const plain = (typeof row.get === 'function' ? row.get({ plain: true }) : row) as Record<string, unknown> & {
    order?: {
      totalAmount?: unknown;
      walletAmountUsed?: unknown;
      shippingAddress?: unknown;
      user?: { id?: string; name?: string; email?: string };
    };
    returnRequests?: unknown[];
  };
  const mapped = mapSubOrder(plain);
  const extra: Record<string, unknown> = {
    returnRequests: plain.returnRequests ?? [],
    shippingAddress: plain.order?.shippingAddress ?? null,
    customer: plain.order?.user ?? null,
  };
  if (plain.order) {
    extra.order = {
      ...plain.order,
      totalAmount: roundMoney(plain.order.totalAmount),
      walletAmountUsed: roundMoney(plain.order.walletAmountUsed),
    };
  }
  return { ...mapped, ...extra };
}

export function suborderListIncludes(vendorId?: string | null) {
  const orderInclude = {
    model: Order,
    as: 'order' as const,
    ...(vendorId ? { where: VENDOR_VISIBLE_ORDER_WHERE, required: true } : {}),
    include: [
      { model: Address, as: 'shippingAddress' },
      { model: User, as: 'user', attributes: ['id', 'name', 'email'] },
    ],
  };

  return [
    {
      model: OrderItem,
      as: 'items',
      include: [
        {
          model: ProductVariant,
          as: 'variant',
          required: false,
          include: [{ model: Product, as: 'product', required: false, paranoid: false, include: ['images'] }],
        },
      ],
    },
    orderInclude,
    { model: Vendor, as: 'vendor' },
    shipmentInclude,
    returnRequestInclude,
  ];
}

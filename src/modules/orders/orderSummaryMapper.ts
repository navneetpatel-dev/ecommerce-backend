import { toPlain } from '@core/repository/toPlain';
import { roundMoney } from '@modules/pricing/money';
import { orderReference } from './orderReference';

type SummaryRow = Record<string, unknown> & {
  subOrders?: Array<{ items?: Array<{ productName?: string | null }> }>;
};

/** Lean order summary for table list views. Excludes heavy subOrders graph and address. */
export function mapOrderSummaryResponse(order: Record<string, unknown>) {
  const plain = toPlain<SummaryRow>(order);
  const subOrders = Array.isArray(plain.subOrders) ? plain.subOrders : [];
  const allItems = subOrders.flatMap((so) => (Array.isArray(so?.items) ? so.items : []));
  const itemNames = allItems.map((it) => it?.productName).filter(Boolean) as string[];
  let itemSummary = 'No items';
  if (itemNames.length === 1) itemSummary = itemNames[0]!;
  else if (itemNames.length === 2) itemSummary = `${itemNames[0]} and ${itemNames[1]}`;
  else if (itemNames.length > 2) itemSummary = `${itemNames[0]} and ${itemNames.length - 1} more`;

  return {
    id: plain.id,
    orderReference: plain.id ? orderReference(String(plain.id)) : null,
    userId: plain.userId,
    customerName: (plain.user as { name?: string } | undefined)?.name ?? null,
    status: plain.status,
    paymentStatus: plain.paymentStatus,
    paymentMethod: plain.paymentMethod ?? null,
    totalAmount: roundMoney(plain.totalAmount),
    sellerCount: subOrders.length,
    itemCount: allItems.length,
    itemSummary,
    createdAt: plain.createdAt,
  };
}

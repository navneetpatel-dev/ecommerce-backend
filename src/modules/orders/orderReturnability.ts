import { ORDER_STATUS } from '@core/constants/statuses';
import { isWithinReturnWindow, returnWindowFor } from '@modules/returns/returnWindow';

type ReturnableLine = {
  id: string;
  quantity: number | string;
  variant?: { product?: { categoryId?: string | null } | null } | null;
};
type ReturnablePart = {
  status: string;
  updatedAt?: Date | null;
  shipment?: { deliveredAt?: Date | null } | null;
  items?: ReturnableLine[];
};

/**
 * The order lines a customer may still ask to return: delivered, with units left, no
 * return request yet, and inside the category's return window. The same rule returns
 * enforce (`returnWindowFor`), so the order view never offers a return that is refused.
 */
export async function returnableOrderItemIds(
  parts: ReturnablePart[],
  linesWithReturns: Set<string>,
  now: Date = new Date(),
): Promise<Set<string>> {
  const returnable = new Set<string>();
  for (const part of parts) {
    if (part.status !== ORDER_STATUS.DELIVERED) continue;
    const deliveredAt = part.shipment?.deliveredAt ?? part.updatedAt ?? null;
    for (const line of part.items ?? []) {
      if (Number(line.quantity) <= 0 || linesWithReturns.has(line.id)) continue;
      const window = await returnWindowFor(line.variant?.product?.categoryId, deliveredAt);
      if (isWithinReturnWindow(window, now)) returnable.add(line.id);
    }
  }
  return returnable;
}

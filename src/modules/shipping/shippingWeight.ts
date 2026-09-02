import { CartItem } from '@database/models/cartItem.model';
import { Product } from '@database/models/product.model';
import { ProductVariant } from '@database/models/productVariant.model';
import { Vendor } from '@database/models/vendor.model';
import { NotFoundError } from '@core/errors/NotFoundError';
import { ValidationError } from '@core/errors/ValidationError';
import { ERROR_MESSAGES } from '@core/constants/errors';
import { cartRepository } from '@modules/cart/cart.repository';

export const DEFAULT_VARIANT_WEIGHT_GRAMS = 500;

type WeightLine = {
  quantity: number;
  variant?: { weightGrams?: number | null } | null;
};

export function lineWeightGramsFromParts(
  quantity: number,
  weightGrams?: number | null,
): number {
  return quantity * Number(weightGrams ?? DEFAULT_VARIANT_WEIGHT_GRAMS);
}

export function computeVendorShippingWeightGrams(items: WeightLine[]): number {
  return items.reduce(
    (sum, item) => sum + lineWeightGramsFromParts(item.quantity, item.variant?.weightGrams),
    0,
  );
}

export function computeVendorShippingWeightsByVendor(
  items: Array<WeightLine & { vendorId: string }>,
): Record<string, number> {
  const byVendor = new Map<string, WeightLine[]>();
  for (const item of items) {
    const bucket = byVendor.get(item.vendorId) ?? [];
    bucket.push(item);
    byVendor.set(item.vendorId, bucket);
  }
  const weights: Record<string, number> = {};
  for (const [vendorId, vendorItems] of byVendor) {
    weights[vendorId] = computeVendorShippingWeightGrams(vendorItems);
  }
  return weights;
}

export async function resolveCartVendorWeightGrams(params: {
  userId: string | null;
  sessionId: string | null;
  vendorId: string;
}): Promise<number> {
  const { userId, sessionId, vendorId } = params;
  if (!userId && !sessionId) {
    throw new ValidationError(ERROR_MESSAGES.SHIPPING_WEIGHT_REQUIRED);
  }

  const cart = userId
    ? await cartRepository.findByUserId(userId)
    : sessionId
      ? await cartRepository.findBySessionId(sessionId)
      : null;
  if (!cart) {
    throw new NotFoundError('Cart');
  }

  const items = (await CartItem.findAll({
    where: { cartId: cart.id },
    include: [
      {
        model: ProductVariant,
        as: 'variant',
        include: [
          {
            model: Product,
            as: 'product',
            include: [{ model: Vendor, as: 'vendor' }],
          },
        ],
      },
    ],
  })) as Array<
    CartItem & {
      variant: ProductVariant & { product: Product & { vendor?: Vendor | null } };
    }
  >;

  const vendorItems = items.filter(
    (item) => (item.variant?.product?.vendorId ?? 'platform') === vendorId,
  );
  if (!vendorItems.length) {
    throw new NotFoundError('Cart');
  }

  return computeVendorShippingWeightGrams(vendorItems);
}

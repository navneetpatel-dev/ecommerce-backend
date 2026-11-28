import { logger } from '@core/logger';
import { ordersService } from '@modules/orders/orders.service';
import { orderReference } from '@modules/orders/orderReference';
import { inr, type EmailItem, type EmailRow } from './templates/blocks';
import type { EmailTemplateData } from './templates/cta';
import type { CartItemWithProduct } from '@core/catalog/productRelations';

/** The fields of an order, its parts, lines and address that the emails read. */
type Amount = number | string | null | undefined;
type AddressView = Partial<Record<'recipientName' | 'line1' | 'line2' | 'city' | 'state' | 'pincode', string | null>>;
type ItemView = {
  productName?: string;
  variantAttributes?: Record<string, string> | null;
  quantity?: Amount;
  lineDisplaySubtotal?: Amount;
  lineTotal?: Amount;
  imageUrl?: string | null;
};
type PartView = { id?: string; vendor?: { businessName?: string } | null; items?: ItemView[] };
type OrderView = {
  id: string;
  subOrders?: PartView[];
  itemsTotal?: Amount;
  merchandiseSubtotal?: Amount;
  couponSavings?: Amount;
  shippingTotal?: Amount;
  giftWrapFeeAmount?: Amount;
  walletAmountUsed?: Amount;
  totalAmount?: Amount;
  paymentMethod?: string | null;
  paymentStatus?: string | null;
  shippingAddress?: AddressView | null;
};

const PAYMENT_LABEL: Record<string, string> = { RAZORPAY: 'Paid online', COD: 'Cash on delivery', WALLET: 'Paid with wallet points' };

function addressText(address: AddressView | null | undefined): string {
  if (!address) return '';
  const place = [address.city, [address.state, address.pincode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return [address.recipientName, address.line1, address.line2, place].filter(Boolean).join('\n');
}

function itemMeta(item: ItemView, sellerName?: string): string | undefined {
  const attributes = Object.values(item.variantAttributes ?? {}).filter(Boolean).join(' · ');
  return [attributes, sellerName ? `Sold by ${sellerName}` : ''].filter(Boolean).join(' · ') || undefined;
}

/**
 * What an order email shows beyond its sentence: the items, the price breakdown and where
 * it goes. Built from the same order view the customer's own order page uses, so the
 * numbers in the email are the numbers on the site.
 */
export async function buildOrderEmailData(
  orderId: string,
  options: { subOrderId?: string; withTotals?: boolean; withAddress?: boolean; withPayment?: boolean } = {},
): Promise<EmailTemplateData> {
  try {
    const order = (await ordersService.getOrderById(orderId)) as unknown as OrderView;
    const parts = (order.subOrders ?? []).filter((part) => !options.subOrderId || part.id === options.subOrderId);

    const items: EmailItem[] = parts.flatMap((part) =>
      (part.items ?? []).map((item) => ({
        name: String(item.productName),
        meta: itemMeta(item, part.vendor?.businessName),
        quantity: Number(item.quantity ?? 1),
        price: inr(item.lineDisplaySubtotal ?? item.lineTotal),
        imageUrl: item.imageUrl ?? null,
      })),
    );

    const totals: EmailRow[] = [];
    if (options.withTotals) {
      totals.push({ label: 'Items (incl. GST)', value: inr(order.itemsTotal ?? order.merchandiseSubtotal) });
      if (Number(order.couponSavings) > 0) totals.push({ label: 'Coupon savings', value: `−${inr(order.couponSavings)}` });
      totals.push({ label: 'Shipping', value: Number(order.shippingTotal) > 0 ? inr(order.shippingTotal) : 'Free' });
      if (Number(order.giftWrapFeeAmount) > 0) totals.push({ label: 'Gift wrap', value: inr(order.giftWrapFeeAmount) });
      if (Number(order.walletAmountUsed) > 0) totals.push({ label: 'Paid with wallet', value: `−${inr(order.walletAmountUsed)}` });
      totals.push({ label: 'Order total', value: inr(order.totalAmount), strong: true });
    }

    const details: EmailRow[] = [{ label: 'Order', value: `#${orderReference(order.id)}`, strong: true }];
    if (options.withPayment) {
      const method = PAYMENT_LABEL[String(order.paymentMethod)] ?? 'Payment';
      details.push({ label: 'Payment', value: order.paymentStatus === 'PAID' ? method : `${method} (${String(order.paymentStatus).toLowerCase()})` });
    }
    if (options.withAddress && order.shippingAddress) details.push({ label: 'Ship to', value: addressText(order.shippingAddress) });

    return {
      items,
      itemsTitle: parts.length > 1 || !options.subOrderId ? 'Your items' : 'Items in this shipment',
      ...(totals.length ? { totals } : {}),
      details,
      detailsTitle: 'Order details',
    };
  } catch (error) {
    // The email still goes out with its sentence; the rich sections are an enhancement.
    logger.warn('Order email details unavailable', { orderId, error: error instanceof Error ? error.message : error });
    return {};
  }
}

/** The items waiting in a cart, for the abandoned-cart reminder: names, photos and current prices. */
export async function buildCartEmailData(cartId: string): Promise<EmailTemplateData> {
  try {
    const { CartItem } = await import('@database/models/cartItem.model');
    const { ProductVariant } = await import('@database/models/productVariant.model');
    const { Product } = await import('@database/models/product.model');
    const { ProductImage } = await import('@database/models/productImage.model');
    const rows = await CartItem.findAll({
      where: { cartId },
      include: [{ model: ProductVariant, as: 'variant', required: true, include: [{ model: Product, as: 'product', required: true, include: [{ model: ProductImage, as: 'images', required: false }] }] }],
      limit: 5,
    });
    const items: EmailItem[] = rows.map((row) => {
      const { variant } = row as CartItemWithProduct;
      const product = variant.product;
      const images = product.images ?? [];
      const image = images.find((img) => img.isPrimary) ?? images[0];
      const unit = Number(variant.price ?? product.displayPrice ?? 0);
      return { name: String(product.name), quantity: Number(row.quantity ?? 1), price: inr(unit * Number(row.quantity ?? 1)), imageUrl: image?.url ?? null };
    });
    return { items, itemsTitle: 'Waiting in your cart' };
  } catch (error) {
    logger.warn('Cart email details unavailable', { cartId, error: error instanceof Error ? error.message : error });
    return {};
  }
}

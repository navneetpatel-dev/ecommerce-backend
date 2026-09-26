import { NotFoundError } from '@core/errors/NotFoundError';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { ValidationError } from '@core/errors/ValidationError';
import { ERROR_MESSAGES } from '@core/constants/errors';
import { buildTaxInvoicePdfFilename } from '@core/export/exportFilenames';
import { Order } from '@database/models/order.model';
import { SubOrder } from '@database/models/subOrder.model';
import { OrderItem } from '@database/models/orderItem.model';
import { Address } from '@database/models/address.model';
import { Vendor } from '@database/models/vendor.model';
import { ProductVariant } from '@database/models/productVariant.model';
import { Product } from '@database/models/product.model';
import { User } from '@database/models/user.model';
import { TaxRule } from '@database/models/taxRule.model';
import {
  renderTaxInvoicePdf,
  toTaxInvoiceSourceFromPlatformInvoice,
  toTaxInvoiceSourceFromSubOrder,
  type TaxInvoiceOrderInput,
  type TaxInvoiceSource,
} from './taxInvoicePdf';
import { settingsService } from '@modules/settings/settings.service';
import { zipBuffers } from './invoiceZip.service';

const orderInvoiceInclude = [
  { model: User, as: 'user', attributes: ['id', 'name'] },
  { model: Address, as: 'shippingAddress' },
  {
    model: SubOrder,
    as: 'subOrders',
    include: [
      { model: Vendor, as: 'vendor' },
      {
        model: OrderItem,
        as: 'items',
        include: [
          {
            model: ProductVariant,
            as: 'variant',
            include: [
              {
                model: Product,
                as: 'product',
                attributes: ['id', 'categoryId', 'name'],
              },
            ],
          },
        ],
      },
    ],
  },
];

async function loadOrder(orderId: string) {
  const order = await Order.findByPk(orderId, {
    include: orderInvoiceInclude as any,
  });
  if (!order) throw new NotFoundError('Order');
  return order;
}

async function hsnMapForOrder(order: Order): Promise<Map<string, string>> {
  const categoryIds = new Set<string>();
  for (const sub of (order as any).subOrders ?? []) {
    for (const item of sub.items ?? []) {
      const catId = item.variant?.product?.categoryId;
      if (catId) categoryIds.add(catId);
    }
  }
  const taxRules = categoryIds.size
    ? await TaxRule.findAll({ where: { categoryId: [...categoryIds] as any } })
    : [];
  return new Map(
    taxRules
      .filter((r) => Boolean(r.categoryId))
      .map((r) => [r.categoryId as string, r.hsnCode ?? '']),
  );
}

/** Tax invoices are issued when a shipment is dispatched (pricing/taxInvoiceIssue). */
const TAX_INVOICE_NOT_ISSUED = 'The tax invoice is issued when the order is shipped';

function assertInvoiceAllocated(sub: SubOrder) {
  if (!sub.taxInvoiceNumber) {
    throw new ValidationError(TAX_INVOICE_NOT_ISSUED);
  }
}

export async function buildSubOrderInvoicePdf(
  order: Order,
  subOrder: SubOrder,
  hsnByCategory: Map<string, string>,
): Promise<{ source: TaxInvoiceSource; pdf: Buffer; filename: string }> {
  assertInvoiceAllocated(subOrder);
  const source = toTaxInvoiceSourceFromSubOrder(
    order as any,
    subOrder as any,
    hsnByCategory,
  );
  const pdf = await renderTaxInvoicePdf(source);
  const vendorSlug = (subOrder as any).vendor?.slug ?? null;
  const filename = buildTaxInvoicePdfFilename(source.invoiceNo, vendorSlug);
  return { source, pdf, filename };
}

/** The platform's own invoice for its fees on the order (gift wrap), when there is one. */
async function buildPlatformInvoicePdf(
  order: Order,
): Promise<{ source: TaxInvoiceSource; pdf: Buffer; filename: string } | null> {
  const snapshot = order.platformInvoiceSnapshot;
  // Issued with the order's first dispatch; none on an order not yet shipped.
  if (!snapshot?.invoiceNumber) return null;
  const settings = await settingsService.getPlatformSettings();
  const orderInput = order as unknown as TaxInvoiceOrderInput;
  const source = toTaxInvoiceSourceFromPlatformInvoice(orderInput, snapshot, {
    legalName: settings.platformLegalName,
    gstin: settings.platformGstin,
    state: settings.platformState,
  });
  const pdf = await renderTaxInvoicePdf(source);
  return { source, pdf, filename: buildTaxInvoicePdfFilename(source.invoiceNo, 'platform') };
}

export async function getCustomerSubOrderInvoice(input: {
  userId: string;
  orderId: string;
  subOrderId: string;
}) {
  const order = await loadOrder(input.orderId);
  if (order.userId !== input.userId) {
    throw new ForbiddenError(ERROR_MESSAGES.NOT_YOUR_ORDER);
  }
  const subOrders = ((order as any).subOrders ?? []) as SubOrder[];
  const sub = subOrders.find((row) => row.id === input.subOrderId);
  if (!sub) throw new NotFoundError('SubOrder');
  const hsnByCategory = await hsnMapForOrder(order);
  return buildSubOrderInvoicePdf(order, sub, hsnByCategory);
}

export async function getCustomerOrderInvoices(input: {
  userId: string;
  orderId: string;
}): Promise<
  | { mode: 'pdf'; filename: string; buffer: Buffer }
  | { mode: 'zip'; filename: string; buffer: Buffer }
> {
  const order = await loadOrder(input.orderId);
  if (order.userId !== input.userId) {
    throw new ForbiddenError(ERROR_MESSAGES.NOT_YOUR_ORDER);
  }
  const subOrders = ((order as any).subOrders ?? []) as SubOrder[];
  if (subOrders.length === 0) throw new NotFoundError('SubOrder');

  const hsnByCategory = await hsnMapForOrder(order);
  const rendered = [];
  // Invoices are issued at dispatch: skip sub-orders not shipped yet (or cancelled).
  for (const sub of subOrders.filter((row) => row.taxInvoiceNumber)) {
    rendered.push(await buildSubOrderInvoicePdf(order, sub, hsnByCategory));
  }
  const platformInvoice = await buildPlatformInvoicePdf(order);
  if (platformInvoice) rendered.push(platformInvoice);
  if (rendered.length === 0) throw new ValidationError(TAX_INVOICE_NOT_ISSUED);

  if (rendered.length === 1) {
    const only = rendered[0]!;
    return { mode: 'pdf', filename: only.filename, buffer: only.pdf };
  }

  const zipBuffer = await zipBuffers(
    rendered.map((row) => ({ name: row.filename, buffer: row.pdf })),
  );
  return {
    mode: 'zip',
    filename: `gst-tax-invoices_order-${order.id.slice(0, 8)}.zip`,
    buffer: zipBuffer,
  };
}

export async function getVendorSubOrderInvoice(input: {
  vendorId: string;
  subOrderId: string;
}) {
  const sub = await SubOrder.findByPk(input.subOrderId, {
    include: [
      { model: Vendor, as: 'vendor' },
      {
        model: OrderItem,
        as: 'items',
        include: [
          {
            model: ProductVariant,
            as: 'variant',
            include: [
              {
                model: Product,
                as: 'product',
                attributes: ['id', 'categoryId', 'name'],
              },
            ],
          },
        ],
      },
      {
        model: Order,
        as: 'order',
        include: [
          { model: User, as: 'user', attributes: ['id', 'name'] },
          { model: Address, as: 'shippingAddress' },
        ],
      },
    ],
  });
  if (!sub) throw new NotFoundError('SubOrder');
  if (sub.vendorId !== input.vendorId) {
    throw new ForbiddenError(ERROR_MESSAGES.NOT_YOUR_VENDOR_REPORT);
  }
  const order = (sub as any).order as Order;
  if (!order) throw new NotFoundError('Order');

  // Attach this single sub-order under order for mapper consistency.
  (order as any).subOrders = [sub];
  const hsnByCategory = await hsnMapForOrder(order);
  return buildSubOrderInvoicePdf(order, sub, hsnByCategory);
}

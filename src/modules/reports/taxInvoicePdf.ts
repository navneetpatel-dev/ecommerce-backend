import {
  createBrandedPdfDocument,
  finalizePdfDocument,
  formatInrAmount,
  formatPdfMoney,
  formatPrintDate,
  rupeesInWords,
  buildMeasuredColumns,
  drawContinuationLabel,
  drawPdfHighlightBox,
  drawPdfMetaCards,
  drawPdfTotalsBox,
  drawSectionBand,
  drawTableHeader,
  drawTableRow,
  measureTableRowHeight,
  PdfPageLayout,
  type PdfColumnSpec,
  type PdfMetaRow,
  type PdfTotalsLine,
} from '@core/pdf';
import { invoiceLineTaxBreakdown } from '@modules/pricing/displayMoney';
import { coerceRupees, roundMoney, sumRupees } from '@modules/pricing/money';
import { TAX_INVOICE_COPY as COPY } from './reports.constants';

export type TaxInvoiceAddress = {
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  pincode: string;
  country: string;
};

export type TaxInvoiceLine = {
  productName: string;
  sku?: string | null;
  hsn: string;
  quantity: number;
  unitPrice: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
};

export type TaxInvoiceSeller = {
  businessName: string;
  gstNumber?: string | null;
  state?: string | null;
  items: TaxInvoiceLine[];
};

/** Single-vendor GST tax invoice (one sub-order). */
export type TaxInvoiceSource = {
  invoiceNo: string;
  orderId: string;
  subOrderId?: string;
  invoiceDate: Date;
  paymentMethod: string | null;
  paymentStatus: string;
  /** Points applied toward this order (order-level; shown for funding clarity). */
  walletAmountUsed?: number;
  /** Online remainder charged via Razorpay (order-level). */
  razorpayAmountPaid?: number;
  /** Vendor slice grand total (customerTotal). */
  totalAmount: number;
  buyerName?: string | null;
  shippingAddress?: TaxInvoiceAddress | null;
  seller: TaxInvoiceSeller;
};

export type TaxInvoiceSubOrderInput = {
  id: string;
  taxInvoiceNumber?: string | null;
  taxInvoiceIssuedAt?: Date | null;
  customerTotal?: number | null;
  taxableAmount?: number | null;
  taxAmount?: number | null;
  vendor?: {
    businessName?: string | null;
    gstNumber?: string | null;
    state?: string | null;
    slug?: string | null;
  } | null;
  items?: Array<{
    productName: string;
    quantity: number;
    unitPrice: number;
    taxableAmount?: number | null;
    taxAmount?: number | null;
    taxBreakdown?: Record<string, unknown> | null;
    variant?: {
      sku?: string | null;
      product?: { categoryId?: string | null } | null;
    } | null;
  }>;
};

export type TaxInvoiceOrderInput = {
  id: string;
  createdAt: Date;
  paymentMethod?: string | null;
  paymentStatus: string;
  walletAmountUsed?: number | null;
  razorpayAmountPaid?: number | null;
  user?: { name?: string | null } | null;
  shippingAddress?: TaxInvoiceAddress | null;
};

/** Re-export formatters used by invoice tests and API consumers. */
export const formatInvoiceMoney = (amount: number) =>
  formatPdfMoney(amount, COPY.currencyPrefix);
export const formatInvoiceDate = formatPrintDate;
export { formatInrAmount, rupeesInWords };

export function paymentMethodLabel(method: string | null): string {
  if (!method) return COPY.emptyValue;
  return COPY.paymentMethodLabels[method] ?? method;
}

/** Payment method line on tax invoice — reflects wallet funding, not only DB enum. */
export function invoiceFundingMethodLabel(source: {
  paymentMethod: string | null;
  walletAmountUsed?: number;
  razorpayAmountPaid?: number;
  totalAmount: number;
}): string {
  const walletUsed = roundMoney(source.walletAmountUsed ?? 0);
  const total = roundMoney(source.totalAmount);
  const online = roundMoney(source.razorpayAmountPaid ?? 0);

  if (walletUsed > 0 && walletUsed >= total) {
    return COPY.paymentMethodLabels.WALLET ?? 'Wallet';
  }
  if (walletUsed > 0 && online > 0) {
    return COPY.paymentMethodLabels.WALLET_PLUS_RAZORPAY ?? 'Wallet + Razorpay';
  }
  if (walletUsed > 0) {
    return COPY.paymentMethodLabels.WALLET ?? 'Wallet';
  }
  return paymentMethodLabel(source.paymentMethod);
}

export function paymentStatusLabel(status: string): string {
  return COPY.paymentStatusLabels[status] ?? status;
}

function lineAmount(item: TaxInvoiceLine): number {
  return roundMoney(item.taxable + item.cgst + item.sgst + item.igst);
}

function statusColor(status: string): string {
  if (status === 'PAID') return '#2C4A6B';
  if (status === 'FAILED' || status === 'REFUNDED') return '#A13A32';
  return '#9C5A12';
}

function mapInvoiceLineTax(item: {
  taxableAmount?: number | null;
  taxAmount?: number | null;
  taxBreakdown?: Record<string, unknown> | null;
}) {
  return invoiceLineTaxBreakdown({
    taxableAmount: item.taxableAmount,
    taxAmount: item.taxAmount,
    taxBreakdown: item.taxBreakdown,
  });
}

function mapSubOrderItems(
  sub: TaxInvoiceSubOrderInput,
  hsnByCategory: Map<string, string>,
): TaxInvoiceLine[] {
  const items: TaxInvoiceLine[] = [];
  for (const item of sub.items ?? []) {
    const tb = mapInvoiceLineTax(item);
    const catId = item.variant?.product?.categoryId ?? undefined;
    const hsn = catId ? (hsnByCategory.get(catId) ?? '') : '';
    items.push({
      productName: item.productName,
      sku: item.variant?.sku ?? null,
      hsn: hsn || COPY.emptyValue,
      quantity: Math.trunc(coerceRupees(item.quantity)) || 0,
      unitPrice: roundMoney(item.unitPrice),
      taxable: roundMoney(item.taxableAmount),
      cgst: tb.cgst,
      sgst: tb.sgst,
      igst: tb.igst,
    });
  }
  return items;
}

/** Map one sub-order into a single-vendor tax invoice source. */
export function toTaxInvoiceSourceFromSubOrder(
  order: TaxInvoiceOrderInput,
  subOrder: TaxInvoiceSubOrderInput,
  hsnByCategory: Map<string, string>,
): TaxInvoiceSource {
  const invoiceNo = subOrder.taxInvoiceNumber;
  if (!invoiceNo) {
    throw new Error('Sub-order is missing taxInvoiceNumber');
  }
  const items = mapSubOrderItems(subOrder, hsnByCategory);
  const vendor = subOrder.vendor;
  const lineTotal = sumRupees(items.map(lineAmount));
  const totalAmount = roundMoney(
    subOrder.customerTotal != null ? subOrder.customerTotal : lineTotal,
  );

  return {
    invoiceNo,
    orderId: order.id,
    subOrderId: subOrder.id,
    invoiceDate: subOrder.taxInvoiceIssuedAt ?? order.createdAt,
    paymentMethod: order.paymentMethod ?? null,
    paymentStatus: order.paymentStatus,
    walletAmountUsed: roundMoney(order.walletAmountUsed ?? 0),
    razorpayAmountPaid: roundMoney(order.razorpayAmountPaid ?? 0),
    totalAmount,
    buyerName: order.user?.name ?? null,
    shippingAddress: order.shippingAddress ?? null,
    seller: {
      businessName: vendor?.businessName || COPY.platformSeller,
      gstNumber: vendor?.gstNumber ?? null,
      state: vendor?.state ?? null,
      items,
    },
  };
}

/** @deprecated Prefer toTaxInvoiceSourceFromSubOrder for new code. */
export function toTaxInvoiceSource(
  invoiceNo: string,
  order: TaxInvoiceOrderInput & {
    totalAmount?: number;
    walletAmountUsed?: number | null;
    subOrders?: TaxInvoiceSubOrderInput[];
  },
  hsnByCategory: Map<string, string>,
): TaxInvoiceSource {
  const first = order.subOrders?.[0];
  if (!first) {
    return {
      invoiceNo,
      orderId: order.id,
      invoiceDate: order.createdAt,
      paymentMethod: order.paymentMethod ?? null,
      paymentStatus: order.paymentStatus,
      totalAmount: roundMoney(order.totalAmount),
      buyerName: order.user?.name ?? null,
      shippingAddress: order.shippingAddress ?? null,
      seller: {
        businessName: COPY.platformSeller,
        items: [],
      },
    };
  }
  return toTaxInvoiceSourceFromSubOrder(
    order,
    {
      ...first,
      taxInvoiceNumber: first.taxInvoiceNumber ?? invoiceNo,
      taxInvoiceIssuedAt: first.taxInvoiceIssuedAt ?? order.createdAt,
      customerTotal: first.customerTotal ?? order.totalAmount,
    },
    hsnByCategory,
  );
}

function itemSubtitle(item: TaxInvoiceLine): string | undefined {
  const bits: string[] = [];
  if (item.sku) bits.push(item.sku);
  if (item.quantity > 1 && item.unitPrice > 0) {
    bits.push(`${item.quantity} x ${formatInrAmount(item.unitPrice)}`);
  }
  return bits.length ? bits.join('  ·  ') : undefined;
}

function buildInvoiceColumns(
  doc: PDFKit.PDFDocument,
  contentWidth: number,
  rows: TaxInvoiceLine[],
) {
  const specs: PdfColumnSpec[] = [
    {
      key: 'name',
      label: COPY.description,
      values: rows.map((r) => r.productName),
      minWidth: 108,
      maxWidth: contentWidth,
      align: 'left',
    },
    {
      key: 'hsn',
      label: COPY.hsn,
      values: rows.map((r) => r.hsn),
      minWidth: 46,
      maxWidth: 64,
      align: 'left',
    },
    {
      key: 'qty',
      label: COPY.qty,
      values: rows.map((r) => String(r.quantity)),
      minWidth: 24,
      maxWidth: 32,
      align: 'right',
    },
    {
      key: 'taxable',
      label: COPY.taxable,
      values: rows.map((r) => formatInrAmount(r.taxable)),
      minWidth: 52,
      maxWidth: 70,
      align: 'right',
    },
    {
      key: 'cgst',
      label: COPY.cgst,
      values: rows.map((r) => formatInrAmount(r.cgst)),
      minWidth: 34,
      maxWidth: 46,
      align: 'right',
    },
    {
      key: 'sgst',
      label: COPY.sgst,
      values: rows.map((r) => formatInrAmount(r.sgst)),
      minWidth: 34,
      maxWidth: 46,
      align: 'right',
    },
    {
      key: 'igst',
      label: COPY.igst,
      values: rows.map((r) => formatInrAmount(r.igst)),
      minWidth: 52,
      maxWidth: 70,
      align: 'right',
    },
    {
      key: 'amount',
      label: COPY.amount,
      values: rows.map((r) => formatInrAmount(lineAmount(r))),
      minWidth: 64,
      maxWidth: 82,
      align: 'right',
    },
  ];

  return buildMeasuredColumns(doc, contentWidth, specs, 'name', 108);
}

function aggregateTotals(seller: TaxInvoiceSeller) {
  let taxable = 0;
  let cgst = 0;
  let sgst = 0;
  let igst = 0;
  for (const item of seller.items) {
    taxable += item.taxable;
    cgst += item.cgst;
    sgst += item.sgst;
    igst += item.igst;
  }
  return {
    taxable: roundMoney(taxable),
    cgst: roundMoney(cgst),
    sgst: roundMoney(sgst),
    igst: roundMoney(igst),
  };
}

function paintTaxInvoice(doc: PDFKit.PDFDocument, source: TaxInvoiceSource) {
  const layout = new PdfPageLayout(
    doc,
    COPY.title,
    `${COPY.title}  ·  ${source.invoiceNo}`,
  );
  layout.startPage(true);

  const payment = [
    invoiceFundingMethodLabel(source),
    paymentStatusLabel(source.paymentStatus),
  ].join('  ·  ');

  const metaLeft: PdfMetaRow[] = [
    { label: COPY.invoiceNo, value: source.invoiceNo, tone: 'ink' },
    { label: COPY.invoiceDate, value: formatPrintDate(source.invoiceDate) },
    { label: COPY.orderId, value: source.orderId, tone: 'muted' },
    { label: COPY.payment, value: payment, tone: 'status' },
  ];
  const walletUsed = roundMoney(source.walletAmountUsed ?? 0);
  if (walletUsed > 0) {
    metaLeft.push({
      label: COPY.walletApplied,
      value: formatInvoiceMoney(walletUsed),
      tone: 'muted',
    });
    const online = roundMoney(source.razorpayAmountPaid ?? 0);
    if (online > 0) {
      metaLeft.push({
        label: COPY.onlinePaid,
        value: formatInvoiceMoney(online),
        tone: 'muted',
      });
    }
  }

  const addr = source.shippingAddress;
  const metaRight: PdfMetaRow[] = [
    {
      label: COPY.billTo,
      value: source.buyerName || COPY.emptyValue,
      tone: 'ink' as const,
    },
  ];
  if (addr) {
    const street = [addr.line1, addr.line2].filter(Boolean).join(', ');
    metaRight.push({
      label: COPY.placeOfSupply,
      value: `${street}\n${addr.city}, ${addr.state} ${addr.pincode}\n${addr.country}`,
      tone: 'ink' as const,
    });
  } else {
    metaRight.push({ label: COPY.placeOfSupply, value: COPY.emptyValue });
  }

  const metaH = drawPdfMetaCards(
    doc,
    layout.margin,
    layout.y,
    layout.contentWidth,
    metaLeft,
    metaRight,
    statusColor(source.paymentStatus),
  );
  layout.y += metaH + 14;

  const seller = source.seller;
  const cols = buildInvoiceColumns(doc, layout.contentWidth, seller.items);
  const tableHeaderH = 16;
  const bandH = 24;
  layout.ensure(bandH + tableHeaderH + 24);
  const gst = `${COPY.gstin}: ${seller.gstNumber || COPY.emptyValue}`;
  const state = seller.state ? `  ·  ${COPY.sellerState}: ${seller.state}` : '';
  drawSectionBand(
    doc,
    layout.margin,
    layout.y,
    layout.contentWidth,
    bandH,
    COPY.seller,
    seller.businessName,
    `${gst}${state}`,
  );
  layout.y += bandH;
  drawTableHeader(doc, layout.margin, layout.y, layout.contentWidth, cols);
  layout.y += tableHeaderH;

  for (let index = 0; index < seller.items.length; index += 1) {
    const item = seller.items[index]!;
    const primary = {
      title: item.productName,
      subtitle: itemSubtitle(item),
    };
    const rowH = measureTableRowHeight(doc, cols, primary);

    if (layout.y + rowH > layout.pageBottomY) {
      layout.addPage();
      layout.y += drawContinuationLabel(
        doc,
        layout.margin,
        layout.y,
        layout.contentWidth,
        `${COPY.seller}: ${seller.businessName}  ·  ${COPY.continuation}`,
      );
      drawTableHeader(doc, layout.margin, layout.y, layout.contentWidth, cols);
      layout.y += tableHeaderH;
    }

    const values: Record<string, string> = {
      name: item.productName,
      hsn: item.hsn,
      qty: String(item.quantity),
      taxable: formatInrAmount(item.taxable),
      cgst: formatInrAmount(item.cgst),
      sgst: formatInrAmount(item.sgst),
      igst: formatInrAmount(item.igst),
      amount: formatInrAmount(lineAmount(item)),
    };

    drawTableRow(
      doc,
      layout.margin,
      layout.y,
      layout.contentWidth,
      rowH,
      cols,
      values,
      index,
      primary,
    );
    layout.y += rowH;
  }
  layout.y += 8;

  const totals = aggregateTotals(seller);
  const tax = roundMoney(totals.cgst + totals.sgst + totals.igst);
  const totalLines: PdfTotalsLine[] = [
    { label: COPY.taxableTotal, value: formatInvoiceMoney(totals.taxable) },
    { label: COPY.cgst, value: formatInvoiceMoney(totals.cgst) },
    { label: COPY.sgst, value: formatInvoiceMoney(totals.sgst) },
    { label: COPY.igst, value: formatInvoiceMoney(totals.igst) },
    { label: COPY.taxTotal, value: formatInvoiceMoney(tax) },
  ];

  const totalsBoxH = 10 + totalLines.length * 16 + 10 + 36;
  layout.ensure(totalsBoxH + 44);
  const boxH = drawPdfTotalsBox(
    doc,
    layout.margin,
    layout.y,
    layout.contentWidth,
    {
      lines: totalLines,
      grandTotalLabel: COPY.grandTotal,
      grandTotalValue: formatInvoiceMoney(source.totalAmount),
    },
  );
  layout.y += boxH + 12;

  const wordsH = drawPdfHighlightBox(
    doc,
    layout.margin,
    layout.y,
    layout.contentWidth,
    COPY.amountInWords,
    rupeesInWords(source.totalAmount),
  );
  layout.y += wordsH + 8;
}

export async function renderTaxInvoicePdf(source: TaxInvoiceSource): Promise<Buffer> {
  const doc = createBrandedPdfDocument({
    title: `${COPY.title} ${source.invoiceNo}`,
    subject: `${COPY.title} for order ${source.orderId}`,
  });
  paintTaxInvoice(doc, source);
  return finalizePdfDocument(doc);
}

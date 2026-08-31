import PDFDocument from 'pdfkit';
import { TAX_INVOICE_COPY as COPY } from './reports.constants';

/** Ink & Brass print tokens — match the storefront light palette. */
const COLOR = {
  brand: '#8A6A2E',
  brandHover: '#6E5322',
  brandSubtle: '#F3ECDA',
  accent: '#A8432B',
  ink: '#1B1917',
  inkMuted: '#5C5750',
  inkFaint: '#9C968D',
  paper: '#F6F3EC',
  surface: '#FFFFFF',
  line: '#D8D1C2',
  lineStrong: '#C4BAA6',
  success: '#2C4A6B',
  warning: '#9C5A12',
  danger: '#A13A32',
  white: '#FFFFFF',
} as const;

const PAGE = {
  margin: 40,
  headerH: 72,
  goldH: 3,
  footerH: 40,
  gutter: 12,
  radius: 3,
} as const;

/** Horizontal inset inside every table cell — keeps numbers inside the shaded row. */
const CELL_PAD = 8;
const NUM_FONT_SIZE = 7;
const HDR_FONT_SIZE = 6.5;
const NAME_FONT_SIZE = 8;

const FONT = {
  regular: 'Helvetica',
  bold: 'Helvetica-Bold',
} as const;

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
  'Seventeen', 'Eighteen', 'Nineteen',
];
const TENS = [
  '', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety',
];

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

export type TaxInvoiceSource = {
  invoiceNo: string;
  orderId: string;
  invoiceDate: Date;
  paymentMethod: string | null;
  paymentStatus: string;
  totalAmount: number;
  walletAmountUsed: number;
  buyerName?: string | null;
  shippingAddress?: TaxInvoiceAddress | null;
  sellers: TaxInvoiceSeller[];
};

export type TaxInvoiceOrderInput = {
  id: string;
  createdAt: Date;
  paymentMethod?: string | null;
  paymentStatus: string;
  totalAmount: number;
  walletAmountUsed?: number | null;
  user?: { name?: string | null } | null;
  shippingAddress?: TaxInvoiceAddress | null;
  subOrders?: Array<{
    vendor?: {
      businessName?: string | null;
      gstNumber?: string | null;
      state?: string | null;
    } | null;
    items?: Array<{
      productName: string;
      quantity: number;
      unitPrice: number;
      taxableAmount?: number | null;
      taxBreakdown?: Record<string, unknown> | null;
      variant?: {
        sku?: string | null;
        product?: { categoryId?: string | null } | null;
      } | null;
    }>;
  }>;
};

type Col = {
  key: 'name' | 'hsn' | 'qty' | 'taxable' | 'cgst' | 'sgst' | 'igst' | 'amount';
  label: string;
  width: number;
  align: 'left' | 'right';
};

/** Indian grouping: 291769.74 -> 2,91,769.74 */
export function formatInrAmount(amount: number): string {
  const n = Number.isFinite(amount) ? amount : 0;
  const [wholeRaw, frac = '00'] = n.toFixed(2).split('.');
  const whole = wholeRaw ?? '0';
  const sign = whole.startsWith('-') ? '-' : '';
  const digits = whole.replace('-', '');
  if (digits.length <= 3) return `${sign}${digits}.${frac}`;
  const last3 = digits.slice(-3);
  const head = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${sign}${head},${last3}.${frac}`;
}

export function formatInvoiceMoney(amount: number): string {
  return `${COPY.currencyPrefix}${formatInrAmount(amount)}`;
}

function underThousand(n: number): string {
  if (n < 20) return ONES[n] ?? '';
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return [TENS[tens], ONES[ones]].filter(Boolean).join(' ');
}

function underThousandWithHundred(n: number): string {
  const hundred = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (hundred) parts.push(`${ONES[hundred]} Hundred`);
  if (rest) parts.push(underThousand(rest));
  return parts.join(' ');
}

/** Indian-system amount in words for GST invoices. */
export function rupeesInWords(amount: number): string {
  const paiseTotal = Math.round((Number.isFinite(amount) ? amount : 0) * 100);
  const abs = Math.abs(paiseTotal);
  const rupees = Math.floor(abs / 100);
  const paise = abs % 100;
  if (rupees === 0 && paise === 0) return 'Rupees Zero Only';

  const crore = Math.floor(rupees / 10_000_000);
  const lakh = Math.floor((rupees % 10_000_000) / 100_000);
  const thousand = Math.floor((rupees % 100_000) / 1_000);
  const rest = rupees % 1_000;
  const parts: string[] = [];
  if (crore) parts.push(`${underThousandWithHundred(crore)} Crore`);
  if (lakh) parts.push(`${underThousandWithHundred(lakh)} Lakh`);
  if (thousand) parts.push(`${underThousandWithHundred(thousand)} Thousand`);
  if (rest) parts.push(underThousandWithHundred(rest));

  let phrase = parts.length ? `Rupees ${parts.join(' ')}` : 'Rupees Zero';
  if (paise) phrase += ` and ${underThousand(paise)} Paise`;
  if (paiseTotal < 0) phrase = `Negative ${phrase}`;
  return `${phrase} Only`;
}

export function formatInvoiceDate(date: Date): string {
  const iso = date.toISOString().slice(0, 10);
  const [year, month, day] = iso.split('-').map(Number);
  return `${day} ${MONTHS[(month ?? 1) - 1]} ${year}`;
}

export function paymentMethodLabel(method: string | null): string {
  if (!method) return COPY.emptyValue;
  return COPY.paymentMethodLabels[method] ?? method;
}

export function paymentStatusLabel(status: string): string {
  return COPY.paymentStatusLabels[status] ?? status;
}

function taxNum(value: unknown): number {
  return Math.round((Number(value ?? 0) || 0) * 100) / 100;
}

export function toTaxInvoiceSource(
  invoiceNo: string,
  order: TaxInvoiceOrderInput,
  hsnByCategory: Map<string, string>,
): TaxInvoiceSource {
  const sellers: TaxInvoiceSeller[] = [];
  for (const sub of order.subOrders ?? []) {
    const vendor = sub.vendor;
    const items: TaxInvoiceLine[] = [];
    for (const item of sub.items ?? []) {
      const tb = (item.taxBreakdown ?? {}) as Record<string, unknown>;
      const catId = item.variant?.product?.categoryId ?? undefined;
      const hsn = catId ? (hsnByCategory.get(catId) ?? '') : '';
      items.push({
        productName: item.productName,
        sku: item.variant?.sku ?? null,
        hsn: hsn || COPY.emptyValue,
        quantity: Number(item.quantity) || 0,
        unitPrice: taxNum(item.unitPrice),
        taxable: taxNum(item.taxableAmount),
        cgst: taxNum(tb.cgst),
        sgst: taxNum(tb.sgst),
        igst: taxNum(tb.igst),
      });
    }
    sellers.push({
      businessName: vendor?.businessName || COPY.platformSeller,
      gstNumber: vendor?.gstNumber ?? null,
      state: vendor?.state ?? null,
      items,
    });
  }
  return {
    invoiceNo,
    orderId: order.id,
    invoiceDate: order.createdAt,
    paymentMethod: order.paymentMethod ?? null,
    paymentStatus: order.paymentStatus,
    totalAmount: taxNum(order.totalAmount),
    walletAmountUsed: taxNum(order.walletAmountUsed),
    buyerName: order.user?.name ?? null,
    shippingAddress: order.shippingAddress ?? null,
    sellers,
  };
}

function money(n: number): string {
  return formatInvoiceMoney(n);
}

function statusColor(status: string): string {
  if (status === 'PAID') return COLOR.success;
  if (status === 'FAILED' || status === 'REFUNDED') return COLOR.danger;
  return COLOR.warning;
}

function lineAmount(item: TaxInvoiceLine): number {
  return taxNum(item.taxable + item.cgst + item.sgst + item.igst);
}

function measureColWidth(
  doc: PDFKit.PDFDocument,
  label: string,
  values: string[],
  minW: number,
  maxW: number,
): number {
  doc.font(FONT.bold).fontSize(HDR_FONT_SIZE);
  let w = doc.widthOfString(label.toUpperCase()) + CELL_PAD * 2;
  doc.font(FONT.regular).fontSize(NUM_FONT_SIZE);
  for (const value of values) {
    w = Math.max(w, doc.widthOfString(value) + CELL_PAD * 2);
  }
  return Math.min(maxW, Math.max(minW, Math.ceil(w)));
}

function buildColumns(
  doc: PDFKit.PDFDocument,
  contentWidth: number,
  source: TaxInvoiceSource,
): Col[] {
  const rows: TaxInvoiceLine[] = [];
  for (const seller of source.sellers) rows.push(...seller.items);

  const qtyVals = rows.map((r) => String(r.quantity));
  const hsnVals = rows.map((r) => r.hsn);
  const taxableVals = rows.map((r) => formatInrAmount(r.taxable));
  const cgstVals = rows.map((r) => formatInrAmount(r.cgst));
  const sgstVals = rows.map((r) => formatInrAmount(r.sgst));
  const igstVals = rows.map((r) => formatInrAmount(r.igst));
  const amountVals = rows.map((r) => formatInrAmount(lineAmount(r)));

  const qtyW = measureColWidth(doc, COPY.qty, qtyVals, 24, 32);
  const hsnW = measureColWidth(doc, COPY.hsn, hsnVals, 46, 64);
  const taxableW = measureColWidth(doc, COPY.taxable, taxableVals, 52, 70);
  const cgstW = measureColWidth(doc, COPY.cgst, cgstVals, 34, 46);
  const sgstW = measureColWidth(doc, COPY.sgst, sgstVals, 34, 46);
  const igstW = measureColWidth(doc, COPY.igst, igstVals, 52, 70);
  const amountW = measureColWidth(doc, COPY.amount, amountVals, 64, 82);

  let finalHsnW = hsnW;
  let finalCgstW = cgstW;
  let finalSgstW = sgstW;
  let fixed = qtyW + finalHsnW + taxableW + finalCgstW + finalSgstW + igstW + amountW;
  let nameW = contentWidth - fixed;
  const MIN_NAME = 108;

  if (nameW < MIN_NAME) {
    const deficit = MIN_NAME - nameW;
    finalCgstW = Math.max(30, cgstW - Math.ceil(deficit / 2));
    finalSgstW = Math.max(30, sgstW - Math.floor(deficit / 2));
    fixed = qtyW + finalHsnW + taxableW + finalCgstW + finalSgstW + igstW + amountW;
    nameW = contentWidth - fixed;
  }

  if (nameW < MIN_NAME) {
    nameW = MIN_NAME;
    fixed = contentWidth - nameW;
  }

  return [
    { key: 'name', label: COPY.description, width: nameW, align: 'left' },
    { key: 'hsn', label: COPY.hsn, width: finalHsnW, align: 'left' },
    { key: 'qty', label: COPY.qty, width: qtyW, align: 'right' },
    { key: 'taxable', label: COPY.taxable, width: taxableW, align: 'right' },
    { key: 'cgst', label: COPY.cgst, width: finalCgstW, align: 'right' },
    { key: 'sgst', label: COPY.sgst, width: finalSgstW, align: 'right' },
    { key: 'igst', label: COPY.igst, width: igstW, align: 'right' },
    { key: 'amount', label: COPY.amount, width: amountW, align: 'right' },
  ];
}

function assertColumnsFit(contentWidth: number, cols: Col[]): void {
  const sum = cols.reduce((acc, col) => acc + col.width, 0);
  const delta = Math.abs(sum - contentWidth);
  if (delta > 0.5) {
    const last = cols[cols.length - 1];
    if (last) last.width += contentWidth - sum;
  }
}

function paintPaper(doc: PDFKit.PDFDocument) {
  const { width, height } = doc.page;
  doc.save();
  doc.rect(0, 0, width, height).fill(COLOR.paper);
  doc.restore();
}

function drawFooter(doc: PDFKit.PDFDocument) {
  const { width, height } = doc.page;
  const y = height - PAGE.footerH;
  doc.save();
  doc.moveTo(PAGE.margin, y).lineTo(width - PAGE.margin, y)
    .strokeColor(COLOR.lineStrong).lineWidth(0.8).stroke();
  doc.font(FONT.regular).fontSize(7.5).fillColor(COLOR.inkFaint);
  doc.text(
    `${COPY.brandName}  ·  ${COPY.brandTagline}`,
    PAGE.margin,
    y + 8,
    { width: 240, lineBreak: false },
  );
  doc.text(
    COPY.computerGenerated,
    PAGE.margin + 240,
    y + 8,
    { width: width - PAGE.margin * 2 - 240, align: 'right', lineBreak: false },
  );
  doc.restore();
}

function drawFirstHeader(doc: PDFKit.PDFDocument) {
  const { width } = doc.page;
  doc.save();
  doc.rect(0, 0, width, PAGE.headerH).fill(COLOR.ink);
  doc.rect(0, PAGE.headerH, width, PAGE.goldH).fill(COLOR.brand);
  doc.font(FONT.bold).fontSize(10).fillColor(COLOR.brand);
  doc.text(COPY.brandName.toUpperCase(), PAGE.margin, 14, {
    width: 280,
    characterSpacing: 1.4,
    lineBreak: false,
  });
  doc.font(FONT.regular).fontSize(8).fillColor(COLOR.inkFaint);
  doc.text(COPY.originalForRecipient, width - PAGE.margin - 160, 16, {
    width: 160,
    align: 'right',
    lineBreak: false,
  });
  doc.font(FONT.bold).fontSize(18).fillColor(COLOR.white);
  doc.text(COPY.title, PAGE.margin, 36, { width: 360, lineBreak: false });
  doc.restore();
}

function drawContinuedHeader(doc: PDFKit.PDFDocument, invoiceNo: string) {
  const { width } = doc.page;
  doc.save();
  doc.rect(0, 0, width, 36).fill(COLOR.ink);
  doc.rect(0, 36, width, 2).fill(COLOR.brand);
  doc.font(FONT.bold).fontSize(9).fillColor(COLOR.brand);
  doc.text(COPY.brandName.toUpperCase(), PAGE.margin, 12, {
    width: 160,
    characterSpacing: 1.2,
    lineBreak: false,
  });
  doc.font(FONT.regular).fontSize(9).fillColor(COLOR.white);
  doc.text(`${COPY.title}  ·  ${invoiceNo}`, PAGE.margin + 170, 12, {
    width: 240,
    lineBreak: false,
  });
  doc.fillColor(COLOR.inkFaint);
  doc.text(COPY.continuation, width - PAGE.margin - 80, 12, {
    width: 80,
    align: 'right',
    lineBreak: false,
  });
  doc.restore();
}

class InvoicePainter {
  private readonly doc: PDFKit.PDFDocument;
  private readonly source: TaxInvoiceSource;
  private readonly contentWidth: number;
  private readonly cols: Col[];
  private readonly pageBottom: number;
  private y = 0;

  constructor(doc: PDFKit.PDFDocument, source: TaxInvoiceSource) {
    this.doc = doc;
    this.source = source;
    this.contentWidth = doc.page.width - PAGE.margin * 2;
    this.cols = buildColumns(doc, this.contentWidth, source);
    assertColumnsFit(this.contentWidth, this.cols);
    this.pageBottom = doc.page.height - PAGE.footerH - 8;
  }

  paint() {
    this.startPage(true);
    this.drawMeta();
    for (const seller of this.source.sellers) {
      this.drawSeller(seller);
    }
    this.drawTotals();
    drawFooter(this.doc);
  }

  private startPage(first: boolean) {
    paintPaper(this.doc);
    if (first) {
      drawFirstHeader(this.doc);
      this.y = PAGE.headerH + PAGE.goldH + 18;
    } else {
      drawContinuedHeader(this.doc, this.source.invoiceNo);
      this.y = 50;
    }
    drawFooter(this.doc);
  }

  private addPage() {
    this.doc.addPage();
    this.startPage(false);
  }

  private ensure(needed: number) {
    if (this.y + needed > this.pageBottom) this.addPage();
  }

  private drawMeta() {
    const cardW = (this.contentWidth - PAGE.gutter) / 2;
    const left = this.metaLinesLeft();
    const right = this.metaLinesRight();
    const cardH = Math.max(
      this.measureMetaHeight(cardW, left),
      this.measureMetaHeight(cardW, right),
    );
    this.ensure(cardH + 12);
    this.drawMetaCard(PAGE.margin, this.y, cardW, cardH, left);
    this.drawMetaCard(
      PAGE.margin + cardW + PAGE.gutter,
      this.y,
      cardW,
      cardH,
      right,
    );
    this.y += cardH + 14;
  }

  private metaLinesLeft(): Array<{ label: string; value: string; tone?: 'ink' | 'muted' | 'status' }> {
    const payment = [
      paymentMethodLabel(this.source.paymentMethod),
      paymentStatusLabel(this.source.paymentStatus),
    ].join('  ·  ');
    return [
      { label: COPY.invoiceNo, value: this.source.invoiceNo, tone: 'ink' },
      { label: COPY.invoiceDate, value: formatInvoiceDate(this.source.invoiceDate) },
      { label: COPY.orderId, value: this.source.orderId, tone: 'muted' },
      { label: COPY.payment, value: payment, tone: 'status' },
    ];
  }

  private metaLinesRight(): Array<{ label: string; value: string; tone?: 'ink' | 'muted' | 'status' }> {
    const addr = this.source.shippingAddress;
    const lines: Array<{ label: string; value: string; tone?: 'ink' | 'muted' | 'status' }> = [
      {
        label: COPY.billTo,
        value: this.source.buyerName || COPY.emptyValue,
        tone: 'ink',
      },
    ];
    if (addr) {
      const street = [addr.line1, addr.line2].filter(Boolean).join(', ');
      lines.push({
        label: COPY.placeOfSupply,
        value: `${street}\n${addr.city}, ${addr.state} ${addr.pincode}\n${addr.country}`,
        tone: 'ink',
      });
    } else {
      lines.push({ label: COPY.placeOfSupply, value: COPY.emptyValue });
    }
    return lines;
  }

  private metaValueWidth(cardW: number, hasLabel: boolean): number {
    return cardW - 24 - (hasLabel ? 78 : 0);
  }

  private measureMetaHeight(
    w: number,
    rows: Array<{ label: string; value: string }>,
  ): number {
    const doc = this.doc;
    let h = 18;
    for (const row of rows) {
      doc.font(FONT.bold).fontSize(8.5);
      const valueH = doc.heightOfString(row.value, {
        width: this.metaValueWidth(w, Boolean(row.label)),
      });
      h += Math.max(14, valueH) + 4;
    }
    return h;
  }

  private drawMetaCard(
    x: number,
    y: number,
    w: number,
    h: number,
    rows: Array<{ label: string; value: string; tone?: 'ink' | 'muted' | 'status' }>,
  ) {
    const doc = this.doc;
    doc.save();
    doc.fillColor(COLOR.surface).strokeColor(COLOR.line).lineWidth(0.8);
    doc.roundedRect(x, y, w, h, PAGE.radius).fillAndStroke();
    let rowY = y + 10;
    const labelW = 78;
    for (const row of rows) {
      if (row.label) {
        doc.font(FONT.regular).fontSize(7).fillColor(COLOR.inkFaint);
        doc.text(row.label.toUpperCase(), x + 12, rowY + 1, {
          width: labelW - 4,
        });
      }
      const fill =
        row.tone === 'status'
          ? statusColor(this.source.paymentStatus)
          : row.tone === 'muted'
            ? COLOR.inkMuted
            : COLOR.ink;
      doc.font(row.tone === 'muted' ? FONT.regular : FONT.bold).fontSize(8.5).fillColor(fill);
      const valueX = x + 12 + (row.label ? labelW : 0);
      const valueW = this.metaValueWidth(w, Boolean(row.label));
      const valueH = doc.heightOfString(row.value, { width: valueW });
      doc.text(row.value, valueX, rowY, { width: valueW });
      rowY += Math.max(14, valueH) + 4;
    }
    doc.restore();
  }

  private drawSeller(seller: TaxInvoiceSeller) {
    const bandH = 24;
    this.ensure(bandH + 18 + 22);
    this.drawSellerBand(seller, bandH);
    this.y += bandH;
    this.drawTableHeader();
    this.y += 16;
    seller.items.forEach((item, index) => this.drawItemRow(seller.businessName, item, index));
    this.y += 8;
  }

  private drawSellerBand(seller: TaxInvoiceSeller, bandH: number) {
    const doc = this.doc;
    const x = PAGE.margin;
    const w = this.contentWidth;
    doc.save();
    doc.rect(x, this.y, w, bandH).fill(COLOR.brandSubtle);
    doc.font(FONT.regular).fontSize(6.5).fillColor(COLOR.brandHover);
    doc.text(COPY.seller.toUpperCase(), x + 12, this.y + 3, { lineBreak: false });
    doc.font(FONT.bold).fontSize(9).fillColor(COLOR.ink);
    doc.text(seller.businessName, x + 12, this.y + 11, {
      width: w * 0.42,
      lineBreak: false,
      ellipsis: true,
    });
    const metaX = x + w * 0.46;
    const gst = `${COPY.gstin}: ${seller.gstNumber || COPY.emptyValue}`;
    const state = seller.state ? `  ·  ${COPY.sellerState}: ${seller.state}` : '';
    doc.font(FONT.regular).fontSize(8).fillColor(COLOR.inkMuted);
    doc.text(`${gst}${state}`, metaX, this.y + 8, {
      width: w * 0.52,
      lineBreak: false,
      ellipsis: true,
    });
    doc.restore();
  }

  private drawTableHeader() {
    const doc = this.doc;
    const x = PAGE.margin;
    const y = this.y;
    doc.save();
    doc.rect(x, y, this.contentWidth, 16).fill(COLOR.brand);
    let cx = x;
    for (const col of this.cols) {
      doc.font(FONT.bold).fontSize(HDR_FONT_SIZE).fillColor(COLOR.white);
      doc.text(col.label.toUpperCase(), cx + CELL_PAD, y + 5, {
        width: col.width - CELL_PAD * 2,
        align: col.align,
        lineBreak: false,
      });
      cx += col.width;
    }
    doc.restore();
  }

  private itemSubtitle(item: TaxInvoiceLine): string {
    const bits: string[] = [];
    if (item.sku) bits.push(item.sku);
    if (item.quantity > 1 && item.unitPrice > 0) {
      bits.push(`${item.quantity} x ${formatInrAmount(item.unitPrice)}`);
    }
    return bits.join('  ·  ');
  }

  private drawCellText(
    cx: number,
    y: number,
    col: Col,
    text: string,
    opts: {
      bold?: boolean;
      size?: number;
      color?: string;
      ellipsis?: boolean;
      multiline?: boolean;
    } = {},
  ) {
    const doc = this.doc;
    const textW = col.width - CELL_PAD * 2;
    doc.font(opts.bold ? FONT.bold : FONT.regular)
      .fontSize(opts.size ?? NUM_FONT_SIZE)
      .fillColor(opts.color ?? COLOR.inkMuted);
    doc.text(text, cx + CELL_PAD, y, {
      width: textW,
      align: col.align,
      lineBreak: opts.multiline ?? false,
      ellipsis: opts.ellipsis ?? col.align === 'left',
    });
  }

  private rowHeight(item: TaxInvoiceLine): number {
    const nameCol = this.cols[0]!;
    const textW = nameCol.width - CELL_PAD * 2;
    this.doc.font(FONT.bold).fontSize(NAME_FONT_SIZE);
    const nameH = this.doc.heightOfString(item.productName, { width: textW });
    const subtitle = this.itemSubtitle(item);
    let extra = 0;
    if (subtitle) {
      this.doc.font(FONT.regular).fontSize(7);
      extra = 2 + this.doc.heightOfString(subtitle, { width: textW });
    }
    return Math.max(20, nameH + extra + 8);
  }

  private drawMiniSeller(name: string) {
    const doc = this.doc;
    doc.font(FONT.bold).fontSize(8).fillColor(COLOR.brandHover);
    doc.text(`${COPY.seller}: ${name}  ·  ${COPY.continuation}`, PAGE.margin, this.y, {
      width: this.contentWidth,
      lineBreak: false,
      ellipsis: true,
    });
    this.y += 14;
  }

  private drawItemRow(sellerName: string, item: TaxInvoiceLine, index: number) {
    const h = this.rowHeight(item);
    if (this.y + h + 4 > this.pageBottom) {
      this.addPage();
      this.drawMiniSeller(sellerName);
      this.drawTableHeader();
      this.y += 16;
    }
    const doc = this.doc;
    const x = PAGE.margin;
    const y = this.y;
    const amount = lineAmount(item);
    doc.save();
    doc.rect(x, y, this.contentWidth, h)
      .fill(index % 2 === 0 ? COLOR.surface : COLOR.brandSubtle);
    doc.restore();

    doc.save();
    doc.rect(x, y, this.contentWidth, h).clip();

    const values: Record<Col['key'], string> = {
      name: item.productName,
      hsn: item.hsn,
      qty: String(item.quantity),
      taxable: formatInrAmount(item.taxable),
      cgst: formatInrAmount(item.cgst),
      sgst: formatInrAmount(item.sgst),
      igst: formatInrAmount(item.igst),
      amount: formatInrAmount(amount),
    };
    let cx = x;
    for (const col of this.cols) {
      if (col.key === 'name') {
        const textW = col.width - CELL_PAD * 2;
        doc.font(FONT.bold).fontSize(NAME_FONT_SIZE).fillColor(COLOR.ink);
        const nameH = doc.heightOfString(values.name, { width: textW });
        doc.text(values.name, cx + CELL_PAD, y + 5, { width: textW });
        const subtitle = this.itemSubtitle(item);
        if (subtitle) {
          doc.font(FONT.regular).fontSize(7).fillColor(COLOR.inkFaint);
          doc.text(subtitle, cx + CELL_PAD, y + 5 + nameH, {
            width: textW,
            lineBreak: false,
            ellipsis: true,
          });
        }
      } else {
        this.drawCellText(cx, y + 5, col, values[col.key]);
      }
      cx += col.width;
    }
    doc.restore();

    doc.moveTo(x, y + h).lineTo(x + this.contentWidth, y + h)
      .strokeColor(COLOR.line).lineWidth(0.4).stroke();
    this.y += h;
  }

  private totals(): { taxable: number; cgst: number; sgst: number; igst: number } {
    let taxable = 0;
    let cgst = 0;
    let sgst = 0;
    let igst = 0;
    for (const seller of this.source.sellers) {
      for (const item of seller.items) {
        taxable += item.taxable;
        cgst += item.cgst;
        sgst += item.sgst;
        igst += item.igst;
      }
    }
    return {
      taxable: taxNum(taxable),
      cgst: taxNum(cgst),
      sgst: taxNum(sgst),
      igst: taxNum(igst),
    };
  }

  private measureTotalsBoxWidth(lines: Array<{ label: string; value: string }>, grandTotal: string): number {
    const doc = this.doc;
    let labelW = 0;
    let valueW = 0;
    doc.font(FONT.regular).fontSize(8);
    for (const line of lines) {
      labelW = Math.max(labelW, doc.widthOfString(line.label));
      valueW = Math.max(valueW, doc.widthOfString(line.value));
    }
    doc.font(FONT.bold).fontSize(10);
    valueW = Math.max(valueW, doc.widthOfString(grandTotal));
    doc.font(FONT.bold).fontSize(8);
    labelW = Math.max(labelW, doc.widthOfString(COPY.grandTotal.toUpperCase()));
    return Math.min(this.contentWidth, Math.ceil(labelW + valueW + 48));
  }

  private drawGrandTotalBar(
    x: number,
    y: number,
    boxW: number,
    labelColW: number,
    valueColW: number,
    grandTotal: string,
  ) {
    const doc = this.doc;
    const barH = 36;
    doc.roundedRect(x, y, boxW, barH, PAGE.radius).fill(COLOR.ink);

    doc.font(FONT.bold).fontSize(8).fillColor(COLOR.brand);
    const labelH = doc.heightOfString(COPY.grandTotal.toUpperCase(), {
      width: labelColW,
      lineBreak: false,
    });
    doc.text(COPY.grandTotal.toUpperCase(), x + 12, y + (barH - labelH) / 2, {
      width: labelColW,
      lineBreak: false,
    });

    doc.font(FONT.bold).fontSize(10).fillColor(COLOR.white);
    const amountH = doc.heightOfString(grandTotal, {
      width: valueColW,
      lineBreak: false,
    });
    doc.text(grandTotal, x + 12 + labelColW, y + (barH - amountH) / 2, {
      width: valueColW,
      align: 'right',
      lineBreak: false,
    });
    return barH;
  }

  private drawTotals() {
    const t = this.totals();
    const tax = taxNum(t.cgst + t.sgst + t.igst);
    const lines: Array<{ label: string; value: string }> = [
      { label: COPY.taxableTotal, value: money(t.taxable) },
      { label: COPY.cgst, value: money(t.cgst) },
      { label: COPY.sgst, value: money(t.sgst) },
      { label: COPY.igst, value: money(t.igst) },
      { label: COPY.taxTotal, value: money(tax) },
    ];
    if (this.source.walletAmountUsed > 0) {
      lines.push({
        label: COPY.walletApplied,
        value: money(this.source.walletAmountUsed),
      });
    }
    const grandTotal = money(this.source.totalAmount);
    const boxW = this.measureTotalsBoxWidth(lines, grandTotal);
    const rows = lines.length;
    const summaryPad = 10;
    const rowH = 16;
    const grandGap = 4;
    const summaryH = summaryPad + rows * rowH + summaryPad;
    const grandBarH = 36;
    const boxH = summaryH + grandGap + grandBarH;
    const wordsH = 36;
    this.ensure(boxH + wordsH + 8);

    const x = PAGE.margin + this.contentWidth - boxW;
    const y = this.y;
    const doc = this.doc;
    const labelColW = Math.min(120, Math.floor(boxW * 0.42));
    const valueColW = boxW - labelColW - 24;

    doc.save();
    doc.fillColor(COLOR.surface).strokeColor(COLOR.line).lineWidth(0.8);
    doc.roundedRect(x, y, boxW, summaryH, PAGE.radius).fillAndStroke();
    let rowY = y + summaryPad;
    for (const line of lines) {
      doc.font(FONT.regular).fontSize(8).fillColor(COLOR.inkMuted);
      doc.text(line.label, x + 12, rowY, { width: labelColW, lineBreak: false });
      doc.font(FONT.regular).fontSize(8.5).fillColor(COLOR.ink);
      doc.text(line.value, x + 12 + labelColW, rowY, {
        width: valueColW,
        align: 'right',
        lineBreak: false,
      });
      rowY += rowH;
    }
    const totalY = y + summaryH + grandGap;
    this.drawGrandTotalBar(x, totalY, boxW, labelColW, valueColW, grandTotal);
    doc.restore();

    this.y += boxH + 12;
    this.drawAmountInWords();
  }

  private drawAmountInWords() {
    const doc = this.doc;
    const x = PAGE.margin;
    const w = this.contentWidth;
    doc.font(FONT.bold).fontSize(9);
    const words = rupeesInWords(this.source.totalAmount);
    const textH = doc.heightOfString(words, { width: w - 24 });
    const boxH = Math.max(36, textH + 24);
    this.ensure(boxH + 8);

    doc.save();
    doc.fillColor(COLOR.brandSubtle).strokeColor(COLOR.line).lineWidth(0.8);
    doc.roundedRect(x, this.y, w, boxH, PAGE.radius).fillAndStroke();
    doc.font(FONT.regular).fontSize(7).fillColor(COLOR.brandHover);
    doc.text(COPY.amountInWords.toUpperCase(), x + 12, this.y + 7, { lineBreak: false });
    doc.font(FONT.bold).fontSize(9).fillColor(COLOR.ink);
    doc.text(words, x + 12, this.y + 18, {
      width: w - 24,
      lineBreak: true,
    });
    doc.restore();
    this.y += boxH + 8;
  }
}

export function renderTaxInvoicePdf(source: TaxInvoiceSource): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 0,
      info: {
        Title: `${COPY.title} ${source.invoiceNo}`,
        Author: COPY.brandName,
        Creator: COPY.brandName,
        Subject: `${COPY.title} for order ${source.orderId}`,
      },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    new InvoicePainter(doc, source).paint();
    doc.end();
  });
}

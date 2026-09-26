import { NotFoundError } from '@core/errors/NotFoundError';
import { ValidationError } from '@core/errors/ValidationError';
import {
  createBrandedPdfDocument,
  finalizePdfDocument,
  PdfPageLayout,
  drawPdfMetaCards,
  drawPdfTotalsBox,
  drawPdfHighlightBox,
  formatInrAmount,
  formatPrintDate,
} from '@core/pdf';
import { WalletRechargeOrder } from '@database/models/walletRechargeOrder.model';
import { User } from '@database/models/user.model';
import { istDateString } from '@modules/pricing/istCalendar';

function nextReceiptNumber(): string {
  // Dated in India time, like the receipt itself.
  const stamp = istDateString(new Date()).replace(/-/g, '');
  const suffix = Math.floor(Math.random() * 900000 + 100000);
  return `WRC-${stamp}-${suffix}`;
}

/**
 * Receipt number for a paid wallet top-up, allocated once. A top-up is prepaid store
 * credit, not a supply: it carries no GST (the goods bought with it are taxed at
 * checkout), so this is a payment receipt, not a tax invoice.
 */
export async function ensureWalletRechargeInvoice(
  rechargeId: string,
): Promise<{ invoiceNumber: string }> {
  const recharge = await WalletRechargeOrder.findByPk(rechargeId);
  if (!recharge || recharge.status !== 'PAID') {
    throw new NotFoundError('WalletRechargeOrder');
  }
  if (recharge.invoiceNumber) return { invoiceNumber: recharge.invoiceNumber };

  const invoiceNumber = nextReceiptNumber();
  await recharge.update({ invoiceNumber, invoiceGeneratedAt: new Date() });
  return { invoiceNumber };
}

export async function getWalletRechargeInvoicePdf(
  userId: string,
  rechargeId: string,
): Promise<{ buffer: Buffer; filename: string }> {
  const recharge = await WalletRechargeOrder.findByPk(rechargeId);
  if (!recharge || recharge.userId !== userId) {
    throw new NotFoundError('WalletRechargeOrder');
  }
  if (recharge.status !== 'PAID') {
    throw new ValidationError('Receipt available only for paid recharges');
  }

  const receipt = await ensureWalletRechargeInvoice(rechargeId);
  const user = await User.findByPk(userId);
  const paidAt = recharge.paidAt ?? recharge.updatedAt;

  const doc = createBrandedPdfDocument({
    title: `Wallet recharge ${receipt.invoiceNumber}`,
    subject: 'Wallet recharge receipt',
  });
  const layout = new PdfPageLayout(doc, 'Wallet Recharge Receipt');
  layout.startPage();

  const cardH = drawPdfMetaCards(
    doc,
    layout.margin,
    layout.y,
    layout.contentWidth,
    [
      { label: 'Receipt', value: receipt.invoiceNumber },
      { label: 'Date', value: formatPrintDate(paidAt) },
      { label: 'Customer', value: user?.name ?? userId },
    ],
    [
      { label: 'Amount', value: formatInrAmount(Number(recharge.amountInr)) },
      { label: 'Points', value: String(Number(recharge.pointsCredited)) },
      { label: 'Status', value: 'PAID', tone: 'status' },
    ],
    undefined,
    { rightValueAlign: 'right' },
  );
  layout.y += cardH + 16;

  const boxH = drawPdfTotalsBox(doc, layout.margin, layout.y, layout.contentWidth, {
    lines: [{ label: 'Points credited', value: String(Number(recharge.pointsCredited)) }],
    grandTotalLabel: 'Total paid',
    grandTotalValue: formatInrAmount(Number(recharge.amountInr)),
  });
  layout.y += boxH + 12;

  drawPdfHighlightBox(
    doc,
    layout.margin,
    layout.y,
    layout.contentWidth,
    'Note',
    'Prepaid store credit, 1 point per rupee. No GST is charged on a top-up; GST applies to the goods you buy with it.',
  );

  const buffer = await finalizePdfDocument(doc);
  return { buffer, filename: `${receipt.invoiceNumber}.pdf` };
}

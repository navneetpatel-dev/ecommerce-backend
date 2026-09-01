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
import { settingsService } from '@modules/settings/settings.service';
import { roundMoney } from '@modules/pricing/money';

function nextInvoiceNumber(): string {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const suffix = Math.floor(Math.random() * 900000 + 100000);
  return `WRC-${stamp}-${suffix}`;
}

export async function ensureWalletRechargeInvoice(rechargeId: string): Promise<{
  invoiceNumber: string;
  taxableAmount: number;
  cgst: number;
  sgst: number;
  igst: number;
}> {
  const recharge = await WalletRechargeOrder.findByPk(rechargeId);
  if (!recharge || recharge.status !== 'PAID') {
    throw new NotFoundError('WalletRechargeOrder');
  }

  if (recharge.invoiceNumber) {
    return {
      invoiceNumber: recharge.invoiceNumber,
      taxableAmount: Number(recharge.taxableAmount ?? recharge.amountInr),
      cgst: Number(recharge.cgst ?? 0),
      sgst: Number(recharge.sgst ?? 0),
      igst: Number(recharge.igst ?? 0),
    };
  }

  const settings = await settingsService.getPlatformSettings();
  const gstRate = Number(settings.commissionGstRatePercent ?? 0);
  const amount = roundMoney(recharge.amountInr);
  const taxableAmount = gstRate > 0 ? roundMoney(amount / (1 + gstRate / 100)) : amount;
  const taxTotal = roundMoney(amount - taxableAmount);
  const half = roundMoney(taxTotal / 2);

  const invoiceNumber = nextInvoiceNumber();
  await recharge.update({
    invoiceNumber,
    taxableAmount,
    cgst: half,
    sgst: half,
    igst: 0,
    invoiceGeneratedAt: new Date(),
  });

  return { invoiceNumber, taxableAmount, cgst: half, sgst: half, igst: 0 };
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
    throw new ValidationError('Invoice available only for paid recharges');
  }

  const invoice = await ensureWalletRechargeInvoice(rechargeId);
  const user = await User.findByPk(userId);
  const paidAt = recharge.paidAt ?? recharge.updatedAt;

  const doc = createBrandedPdfDocument({
    title: `Wallet recharge ${invoice.invoiceNumber}`,
    subject: 'Prepaid store credit invoice',
  });
  const layout = new PdfPageLayout(doc, 'Wallet Recharge Invoice');
  layout.startPage();

  const cardH = drawPdfMetaCards(
    doc,
    layout.margin,
    layout.y,
    layout.contentWidth,
    [
      { label: 'Invoice', value: invoice.invoiceNumber },
      { label: 'Date', value: formatPrintDate(paidAt) },
      { label: 'Customer', value: user?.name ?? userId },
    ],
    [
      { label: 'Amount', value: formatInrAmount(Number(recharge.amountInr)) },
      { label: 'Points', value: String(Number(recharge.pointsCredited)) },
      { label: 'Status', value: 'PAID', tone: 'status' },
    ],
  );
  layout.y += cardH + 16;

  const boxH = drawPdfTotalsBox(doc, layout.margin, layout.y, layout.contentWidth, {
    lines: [
      { label: 'Taxable value', value: formatInrAmount(invoice.taxableAmount) },
      { label: 'CGST', value: formatInrAmount(invoice.cgst) },
      { label: 'SGST', value: formatInrAmount(invoice.sgst) },
    ],
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
    'Prepaid store credit — not a merchandise tax invoice.',
  );

  const buffer = await finalizePdfDocument(doc);
  return { buffer, filename: `${invoice.invoiceNumber}.pdf` };
}

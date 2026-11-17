import PDFDocument from 'pdfkit';
import { Payout } from '@database/models/payout.model';
import { Vendor } from '@database/models/vendor.model';
import { SubOrder } from '@database/models/subOrder.model';
import { logger } from '@core/logger';
import type { MailAttachment } from '@config/mail';
import { EMAIL_COPY } from './emailCopy';
import type { EmailAttachmentSpec } from './notificationDelivery';

const rupees = (paise: number) =>
  `Rs. ${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** A one-page payout statement: what the vendor earned and every deduction behind the amount paid. */
export async function renderPayoutStatementPdf(payout: Payout, vendor: { businessName?: string | null }): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 48 });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  const date = (value: Date | null) => (value ? new Date(value).toISOString().slice(0, 10) : '—');

  doc.fontSize(18).text(`${EMAIL_COPY.brandName} — Payout statement`);
  doc.moveDown(0.5).fontSize(10).fillColor('#555');
  doc.text(`Seller: ${vendor.businessName ?? '—'}`);
  doc.text(`Statement for sales ${date(payout.periodStart)} to ${date(payout.periodEnd)}`);
  doc.text(`Paid on: ${date(payout.paidAt)}`);
  if (payout.paymentReferenceNumber) doc.text(`Reference: ${payout.paymentReferenceNumber}${payout.paymentMethod ? ` (${payout.paymentMethod})` : ''}`);
  doc.moveDown().fillColor('#000').fontSize(12);

  const lines: Array<[string, string]> = [
    ['Sales (net of commission)', rupees(Number(payout.grossPaise ?? 0))],
    ['TDS withheld (194-O)', `- ${rupees(Number(payout.tdsPaise ?? 0))}`],
    ['GST on commission', `- ${rupees(Number(payout.commissionGstPaise ?? 0))}`],
    ['Adjustments', rupees(Number(payout.adjustmentPaise ?? 0))],
  ];
  for (const [label, value] of lines) doc.text(`${label}: ${value}`);
  doc.moveDown(0.5).fontSize(14).text(`Amount paid: Rs. ${Number(payout.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`);
  if (payout.remarks) doc.moveDown().fontSize(10).fillColor('#555').text(`Note: ${payout.remarks}`);
  doc.end();
  return done;
}

async function buildOne(spec: EmailAttachmentSpec): Promise<MailAttachment | null> {
  if (spec.kind === 'taxInvoice') {
    const { buildSubOrderInvoiceForEmail } = await import('@modules/reports/taxInvoice.service');
    const sub = await SubOrder.findByPk(spec.subOrderId, { attributes: ['id', 'orderId'] });
    if (!sub) return null;
    const built = await buildSubOrderInvoiceForEmail(sub.orderId, spec.subOrderId);
    return { filename: built.filename, content: built.pdf, contentType: 'application/pdf' };
  }
  if (spec.kind === 'commissionInvoice') {
    const { commissionsService } = await import('@modules/commissions/commissions.service');
    const { buffer, filename } = await commissionsService.getCommissionInvoicePdf(spec.invoiceId);
    return { filename, content: buffer, contentType: 'application/pdf' };
  }
  const payout = await Payout.findByPk(spec.payoutId, { include: [{ model: Vendor, attributes: ['businessName'] }] });
  if (!payout) return null;
  const vendor = ((payout as unknown as { Vendor?: { businessName?: string | null } }).Vendor) ?? {};
  const buffer = await renderPayoutStatementPdf(payout, vendor);
  return { filename: `payout-statement_${payout.id.slice(0, 8)}.pdf`, content: buffer, contentType: 'application/pdf' };
}

/**
 * Builds the documents an email carries. A document that cannot be built is skipped and
 * logged: the email still goes out, because the message matters more than its copy of the PDF.
 */
export async function buildEmailAttachments(specs: EmailAttachmentSpec[] | undefined): Promise<MailAttachment[]> {
  const attachments: MailAttachment[] = [];
  for (const spec of specs ?? []) {
    try {
      const built = await buildOne(spec);
      if (built) attachments.push(built);
    } catch (error) {
      logger.warn('Email attachment skipped', { kind: spec.kind, error: error instanceof Error ? error.message : error });
    }
  }
  return attachments;
}

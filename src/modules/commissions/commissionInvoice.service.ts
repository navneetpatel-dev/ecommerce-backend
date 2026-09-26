import type { Transaction } from 'sequelize';
import PDFDocument from 'pdfkit';
import { CommissionInvoice } from '@database/models/commissionInvoice.model';
import { Vendor } from '@database/models/vendor.model';
import { fromPaise } from '@modules/pricing/money';
import { gstOnTaxablePaise } from '@modules/pricing/pricing.engine';
import {
  nextVendorDocumentNumber,
  VENDOR_DOCUMENT_KIND,
} from '@modules/pricing/vendorInvoiceSequence';
import { settingsService } from '@modules/settings/settings.service';
import { isIntraStateSupply } from '@modules/pricing/gstPlaceOfSupply';

export type CreateCommissionInvoiceInput = {
  vendorId: string;
  payoutId: string;
  periodStart: Date;
  periodEnd: Date;
  /** Commission taxable value in paise (ex-GST). */
  commissionTaxablePaise: number;
  actorId: string | null;
};

/**
 * A commission document with negative amounts is a credit note: the payout's returns
 * handed back more commission than its sales earned, with the GST on it.
 */
export function isCommissionCreditNote(invoice: { taxablePaise: number | string }): boolean {
  return Number(invoice.taxablePaise) < 0;
}

/**
 * Issue a platform → vendor GST invoice for marketplace commission (SAC 9985), or a
 * commission credit note (numbered in the platform credit-note series) when the payout's
 * commission is negative.
 */
export async function createCommissionInvoiceForPayout(
  input: CreateCommissionInvoiceInput,
  transaction: Transaction,
): Promise<CommissionInvoice | null> {
  if (input.commissionTaxablePaise === 0) return null;
  const creditNote = input.commissionTaxablePaise < 0;

  const existing = await CommissionInvoice.findOne({
    where: { payoutId: input.payoutId },
    transaction,
  });
  if (existing) return existing;

  const settings = await settingsService.getPlatformSettings();
  // settings.commissionGstRatePercent always has a DB default (see settings.service.ts DEFAULTS);
  // this fallback should never actually trigger.
  const gstRate = Number(settings.commissionGstRatePercent ?? 18);
  const issuedAt = new Date();
  const { number } = await nextVendorDocumentNumber(
    null,
    creditNote ? VENDOR_DOCUMENT_KIND.CREDIT_NOTE : VENDOR_DOCUMENT_KIND.COMMISSION_INVOICE,
    issuedAt,
    transaction,
  );

  const vendor = await Vendor.findByPk(input.vendorId, {
    attributes: ['id', 'state', 'gstNumber', 'businessName'],
    transaction,
  });
  const intra = isIntraStateSupply(settings.platformState, vendor?.state);
  // CGST and SGST each at half the rate (equal), or IGST; a credit note's are negative.
  // The payout deducted the same total (vendorPayoutBreakdown with the vendor's state).
  const {
    cgst: cgstPaise,
    sgst: sgstPaise,
    igst: igstPaise,
    total: gstPaise,
  } = gstOnTaxablePaise(input.commissionTaxablePaise, gstRate, intra);

  return CommissionInvoice.create(
    {
      number,
      vendorId: input.vendorId,
      payoutId: input.payoutId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      taxablePaise: input.commissionTaxablePaise,
      gstPaise,
      cgstPaise,
      sgstPaise,
      igstPaise,
      totalPaise: input.commissionTaxablePaise + gstPaise,
      gstRatePercent: gstRate,
      sacCode: '9985',
      placeOfSupplyState: vendor?.state ?? settings.platformState ?? null,
      issuedAt,
      createdBy: input.actorId,
      updatedBy: input.actorId,
      deletedBy: null,
    },
    { transaction },
  );
}

export async function renderCommissionInvoicePdf(
  invoice: CommissionInvoice,
  vendor: { businessName?: string | null; gstNumber?: string | null; state?: string | null },
): Promise<Buffer> {
  const settings = await settingsService.getPlatformSettings();
  const doc = new PDFDocument({ size: 'A4', margin: 48 });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));

  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const creditNote = isCommissionCreditNote(invoice);
  doc
    .fontSize(16)
    .text(
      creditNote ? 'Credit Note — Marketplace Commission' : 'Tax Invoice — Marketplace Commission',
      { align: 'left' },
    );
  doc.moveDown(0.5);
  doc.fontSize(10);
  doc.text(`${creditNote ? 'Credit Note' : 'Invoice'} No: ${invoice.number}`);
  doc.text(`Date: ${invoice.issuedAt.toISOString().slice(0, 10)}`);
  doc.text(`SAC: ${invoice.sacCode}`);
  doc.moveDown();
  doc.text('Supplier (Platform)');
  doc.text(settings.platformLegalName || 'Marketplace Operator');
  if (settings.platformGstin) doc.text(`GSTIN: ${settings.platformGstin}`);
  if (settings.platformState) doc.text(`State: ${settings.platformState}`);
  doc.moveDown();
  doc.text('Recipient (Vendor)');
  doc.text(vendor.businessName || invoice.vendorId);
  if (vendor.gstNumber) doc.text(`GSTIN: ${vendor.gstNumber}`);
  if (vendor.state) doc.text(`State: ${vendor.state}`);
  doc.moveDown();
  doc.text(`Period: ${invoice.periodStart.toISOString().slice(0, 10)} → ${invoice.periodEnd.toISOString().slice(0, 10)}`);
  doc.moveDown();
  doc.text(`Taxable commission: Rs ${fromPaise(Number(invoice.taxablePaise)).toFixed(2)}`);
  doc.text(`GST @ ${Number(invoice.gstRatePercent)}%: Rs ${fromPaise(Number(invoice.gstPaise)).toFixed(2)}`);
  if (Number(invoice.igstPaise) > 0) {
    doc.text(`  IGST: Rs ${fromPaise(Number(invoice.igstPaise)).toFixed(2)}`);
  } else {
    doc.text(`  CGST: Rs ${fromPaise(Number(invoice.cgstPaise)).toFixed(2)}`);
    doc.text(`  SGST: Rs ${fromPaise(Number(invoice.sgstPaise)).toFixed(2)}`);
  }
  doc.text(`Total: Rs ${fromPaise(Number(invoice.totalPaise)).toFixed(2)}`);
  doc.moveDown();
  doc.fontSize(8).fillColor('#666').text(
    'This invoice is for marketplace commission / facilitation services charged by the ecommerce operator to the seller.',
  );
  doc.end();
  return done;
}

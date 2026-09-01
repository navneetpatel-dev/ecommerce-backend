import PDFDocument from 'pdfkit';
import { NotFoundError } from '@core/errors/NotFoundError';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { ERROR_MESSAGES } from '@core/constants/errors';
import { CreditNote } from '@database/models/creditNote.model';
import { DebitNote } from '@database/models/debitNote.model';
import { ReturnRequest } from '@database/models/returnRequest.model';
import { Vendor } from '@database/models/vendor.model';
import { User } from '@database/models/user.model';
import { fromPaise } from '@modules/pricing/money';

async function pdfBuffer(
  paint: (doc: PDFKit.PDFDocument) => void,
): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 48 });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  paint(doc);
  doc.end();
  return done;
}

export async function renderCreditNotePdf(note: CreditNote, meta: {
  vendorName?: string | null;
  vendorGstin?: string | null;
  customerName?: string | null;
}): Promise<Buffer> {
  const tb = (note.taxBreakdown as Record<string, unknown> | null) ?? {};
  return pdfBuffer((doc) => {
    doc.fontSize(16).text('Credit Note', { align: 'left' });
    doc.moveDown(0.5);
    doc.fontSize(10);
    doc.text(`Credit Note No: ${note.number}`);
    if (note.againstInvoiceNumber) {
      doc.text(`Against Invoice: ${note.againstInvoiceNumber}`);
    }
    doc.text(`Date: ${(note.issuedAt ?? note.createdAt).toISOString().slice(0, 10)}`);
    doc.moveDown();
    doc.text(`Seller: ${meta.vendorName || note.vendorId || '—'}`);
    if (meta.vendorGstin) doc.text(`GSTIN: ${meta.vendorGstin}`);
    doc.text(`Buyer: ${meta.customerName || '—'}`);
    doc.moveDown();
    doc.text(`Merchandise: Rs ${fromPaise(Number(note.merchandisePaise)).toFixed(2)}`);
    doc.text(`Tax: Rs ${fromPaise(Number(note.taxPaise)).toFixed(2)}`);
    if (Number(tb.igst ?? 0) > 0) {
      doc.text(`  IGST: Rs ${fromPaise(Number(tb.igst)).toFixed(2)}`);
    } else {
      doc.text(`  CGST: Rs ${fromPaise(Number(tb.cgst ?? 0)).toFixed(2)}`);
      doc.text(`  SGST: Rs ${fromPaise(Number(tb.sgst ?? 0)).toFixed(2)}`);
    }
    doc.text(`Total credit: Rs ${fromPaise(Number(note.totalPaise)).toFixed(2)}`);
    if (note.reason) {
      doc.moveDown();
      doc.text(`Reason: ${note.reason}`);
    }
  });
}

export async function renderDebitNotePdf(note: DebitNote, meta: {
  vendorName?: string | null;
  vendorGstin?: string | null;
}): Promise<Buffer> {
  return pdfBuffer((doc) => {
    doc.fontSize(16).text('Debit Note', { align: 'left' });
    doc.moveDown(0.5);
    doc.fontSize(10);
    doc.text(`Debit Note No: ${note.number}`);
    if (note.againstInvoiceNumber) {
      doc.text(`Against Invoice: ${note.againstInvoiceNumber}`);
    }
    doc.text(`Date: ${(note.issuedAt ?? note.createdAt).toISOString().slice(0, 10)}`);
    doc.moveDown();
    doc.text(`Vendor: ${meta.vendorName || note.vendorId}`);
    if (meta.vendorGstin) doc.text(`GSTIN: ${meta.vendorGstin}`);
    doc.moveDown();
    doc.text(`Commission clawback: Rs ${fromPaise(Number(note.commissionPaise)).toFixed(2)}`);
    doc.text(`TCS clawback: Rs ${fromPaise(Number(note.tcsPaise)).toFixed(2)}`);
    doc.text(`Net clawback: Rs ${fromPaise(Number(note.netClawbackPaise)).toFixed(2)}`);
    if (note.reason) {
      doc.moveDown();
      doc.text(`Reason: ${note.reason}`);
    }
  });
}

export async function getCreditNotePdfForActor(input: {
  noteId: string;
  userId: string;
  vendorId?: string | null;
  isAdmin?: boolean;
}): Promise<{ buffer: Buffer; filename: string }> {
  const note = await CreditNote.findByPk(input.noteId, {
    include: [
      { model: Vendor, as: 'Vendor', attributes: ['id', 'businessName', 'gstNumber'] },
      { model: User, as: 'User', attributes: ['id', 'name'] },
      { model: ReturnRequest, as: 'ReturnRequest', attributes: ['id', 'userId'] },
    ],
  });
  if (!note) throw new NotFoundError('CreditNote');
  const ret = (note as any).ReturnRequest as ReturnRequest | undefined;
  const vendor = (note as any).Vendor as Vendor | undefined;
  const user = (note as any).User as User | undefined;
  const isOwner = ret?.userId === input.userId || note.userId === input.userId;
  const isVendor = Boolean(input.vendorId && note.vendorId === input.vendorId);
  if (!input.isAdmin && !isOwner && !isVendor) {
    throw new ForbiddenError(ERROR_MESSAGES.CREDIT_NOTE_FORBIDDEN);
  }
  const buffer = await renderCreditNotePdf(note, {
    vendorName: vendor?.businessName,
    vendorGstin: vendor?.gstNumber,
    customerName: user?.name,
  });
  return {
    buffer,
    filename: `credit-note_${note.number.replace(/\//g, '-').toLowerCase()}.pdf`,
  };
}

export async function getDebitNotePdfForActor(input: {
  noteId: string;
  vendorId?: string | null;
  isAdmin?: boolean;
}): Promise<{ buffer: Buffer; filename: string }> {
  const note = await DebitNote.findByPk(input.noteId, {
    include: [{ model: Vendor, as: 'Vendor', attributes: ['id', 'businessName', 'gstNumber'] }],
  });
  if (!note) throw new NotFoundError('DebitNote');
  const vendor = (note as any).Vendor as Vendor | undefined;
  const isVendor = Boolean(input.vendorId && note.vendorId === input.vendorId);
  if (!input.isAdmin && !isVendor) {
    throw new ForbiddenError(ERROR_MESSAGES.DEBIT_NOTE_FORBIDDEN);
  }
  const buffer = await renderDebitNotePdf(note, {
    vendorName: vendor?.businessName,
    vendorGstin: vendor?.gstNumber,
  });
  return {
    buffer,
    filename: `debit-note_${note.number.replace(/\//g, '-').toLowerCase()}.pdf`,
  };
}

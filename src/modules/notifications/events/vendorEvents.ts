import { Op } from 'sequelize';
import { logger } from '@core/logger';
import { Vendor } from '@database/models/vendor.model';
import { VendorDocument } from '@database/models/vendorDocument.model';
import { ProductQuestion } from '@database/models/productQuestion.model';
import { Product } from '@database/models/product.model';
import { CommissionInvoice } from '@database/models/commissionInvoice.model';
import type { Payout } from '@database/models/payout.model';
import { VENDOR_STATUS } from '@core/constants/statuses';
import { notificationsService } from '../notifications.service';
import { findVendorOwnerUserId } from '../orderNotifications';
import { inr } from '../templates/blocks';

const DAY_MS = 24 * 60 * 60 * 1000;
const warn = (what: string, id: string, error: unknown) =>
  logger.warn(`${what} email failed`, { id, error: error instanceof Error ? error.message : error });

const DOCUMENT_LABEL = (type: string) =>
  type.toLowerCase().replace(/_/g, ' ').replace(/^\w/, (letter) => letter.toUpperCase());

/** A seller uploaded (or replaced) a verification document. */
export async function notifyKycDocumentReceived(documentId: string): Promise<void> {
  try {
    const doc = await VendorDocument.findByPk(documentId);
    const ownerId = doc ? await findVendorOwnerUserId(doc.vendorId) : null;
    if (!doc || !ownerId) return;
    await notificationsService.enqueue({
      userId: ownerId,
      type: 'KYC_DOCUMENT_RECEIVED',
      referenceType: 'VendorDocument',
      // A replaced document is a new submission, so it gets its own acknowledgement.
      referenceId: `${doc.id}-${doc.updatedAt.getTime()}`,
      templateData: { documentName: DOCUMENT_LABEL(doc.type) },
    });
  } catch (error) {
    warn('KYC received', documentId, error);
  }
}

/** An admin approved a verification document. */
export async function notifyKycDocumentApproved(documentId: string): Promise<void> {
  try {
    const doc = await VendorDocument.findByPk(documentId);
    const ownerId = doc ? await findVendorOwnerUserId(doc.vendorId) : null;
    if (!doc || !ownerId) return;
    const [verified, total] = await Promise.all([
      VendorDocument.count({ where: { vendorId: doc.vendorId, verified: true } }),
      VendorDocument.count({ where: { vendorId: doc.vendorId } }),
    ]);
    await notificationsService.enqueue({
      userId: ownerId,
      type: 'KYC_DOCUMENT_APPROVED',
      referenceType: 'VendorDocument',
      referenceId: `${doc.id}-${doc.updatedAt.getTime()}`,
      templateData: { documentName: DOCUMENT_LABEL(doc.type), progress: `${verified} of ${total} documents are approved.` },
    });
  } catch (error) {
    warn('KYC approved', documentId, error);
  }
}

/**
 * Sellers whose verification is still incomplete a few days after approval get a weekly
 * reminder listing what is missing or rejected. Returns how many were queued.
 */
export async function processKycReminders(now: Date = new Date()): Promise<number> {
  const vendors = await Vendor.findAll({
    where: { status: VENDOR_STATUS.APPROVED, kycVerified: false, createdAt: { [Op.lt]: new Date(now.getTime() - 3 * DAY_MS) } },
    attributes: ['id', 'businessName'],
    limit: 200,
  });
  const week = Math.floor(now.getTime() / (7 * DAY_MS));
  let queued = 0;
  for (const vendor of vendors) {
    try {
      const ownerId = await findVendorOwnerUserId(vendor.id);
      if (!ownerId) continue;
      const docs = await VendorDocument.findAll({ where: { vendorId: vendor.id }, attributes: ['type', 'verified', 'rejectedAt'] });
      const open = docs.filter((doc) => !doc.verified).map((doc) => `${DOCUMENT_LABEL(doc.type)} — ${doc.rejectedAt ? 'rejected, upload a clearer copy' : 'waiting for review'}`);
      const log = await notificationsService.enqueue({
        userId: ownerId,
        type: 'KYC_PENDING_REMINDER',
        referenceType: 'VendorKyc',
        referenceId: `${vendor.id}-w${week}`,
        templateData: { businessName: vendor.businessName, bullets: open.length ? open : ['Required verification documents have not been uploaded yet'] },
      });
      if (log) queued += 1;
    } catch (error) {
      warn('KYC reminder', vendor.id, error);
    }
  }
  return queued;
}

/** A shopper's question on a seller's product is live: the seller can answer it. */
export async function notifyVendorNewQuestion(questionId: string): Promise<void> {
  try {
    const question = await ProductQuestion.findByPk(questionId);
    if (!question || question.status !== 'PUBLISHED') return;
    const product = await Product.findByPk(question.productId, { attributes: ['id', 'name', 'vendorId'] });
    const recipient = product?.vendorId ? await findVendorOwnerUserId(product.vendorId) : null;
    if (!product || !recipient) return;
    await notificationsService.enqueue({
      userId: recipient,
      type: 'VENDOR_NEW_QUESTION',
      referenceType: 'ProductQuestion',
      referenceId: question.id,
      templateData: { productName: product.name, questionText: question.question.slice(0, 400) },
    });
  } catch (error) {
    warn('New question', questionId, error);
  }
}

/** A commission invoice was issued for a payout: the seller gets it as a PDF. */
export async function notifyCommissionInvoiceReady(invoiceId: string): Promise<void> {
  try {
    const invoice = await CommissionInvoice.findByPk(invoiceId);
    const ownerId = invoice ? await findVendorOwnerUserId(invoice.vendorId) : null;
    if (!invoice || !ownerId) return;
    const period = `${invoice.periodStart.toISOString().slice(0, 10)} to ${invoice.periodEnd.toISOString().slice(0, 10)}`;
    await notificationsService.enqueue({
      userId: ownerId,
      type: 'COMMISSION_INVOICE_READY',
      referenceType: 'CommissionInvoice',
      referenceId: invoice.id,
      attachments: [{ kind: 'commissionInvoice', invoiceId: invoice.id }],
      templateData: {
        period,
        details: [
          { label: 'Invoice number', value: invoice.number, strong: true },
          { label: 'Commission', value: inr(invoice.taxablePaise / 100) },
          { label: 'GST on commission', value: inr(invoice.gstPaise / 100) },
          { label: 'Invoice total', value: inr(invoice.totalPaise / 100), strong: true },
        ],
      },
    });
  } catch (error) {
    warn('Commission invoice', invoiceId, error);
  }
}

/** A payout was paid: the amount, the deductions behind it, and a statement PDF. */
export async function notifyPayoutPaid(payout: Payout): Promise<void> {
  try {
    const ownerId = await findVendorOwnerUserId(payout.vendorId);
    if (!ownerId) return;
    await notificationsService.sendPayoutPaid(
      ownerId,
      payout.id,
      {
        amount: Number(payout.amount),
        paymentMethod: payout.paymentMethod,
        paymentReferenceNumber: payout.paymentReferenceNumber,
        paidAt: payout.paidAt,
        details: [
          { label: 'Sales (net of commission)', value: inr(Number(payout.grossPaise ?? 0) / 100) },
          { label: 'TDS withheld', value: `−${inr(Number(payout.tdsPaise ?? 0) / 100)}` },
          { label: 'GST on commission', value: `−${inr(Number(payout.commissionGstPaise ?? 0) / 100)}` },
          { label: 'Paid to you', value: inr(Number(payout.amount)), strong: true },
        ],
      },
      [{ kind: 'payoutStatement', payoutId: payout.id }],
    );
  } catch (error) {
    warn('Payout paid', payout.id, error);
  }
}

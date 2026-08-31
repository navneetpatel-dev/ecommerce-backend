import type { Transaction } from 'sequelize';
import { Vendor } from '@database/models/vendor.model';
import { VendorInvoiceSequence } from '@database/models/vendorInvoiceSequence.model';

const PLATFORM_PREFIX = 'PLAT';
const SERIAL_WIDTH = 8;

/** Document kinds that share vendor_invoice_sequences (per vendor + FY + kind). */
export const VENDOR_DOCUMENT_KIND = {
  TAX_INVOICE: 'TAX_INVOICE',
  CREDIT_NOTE: 'CREDIT_NOTE',
  DEBIT_NOTE: 'DEBIT_NOTE',
  COMMISSION_INVOICE: 'COMMISSION_INVOICE',
} as const;

export type VendorDocumentKind =
  (typeof VENDOR_DOCUMENT_KIND)[keyof typeof VENDOR_DOCUMENT_KIND];

const KIND_INFIX: Record<VendorDocumentKind, string | null> = {
  TAX_INVOICE: null,
  CREDIT_NOTE: 'CN',
  DEBIT_NOTE: 'DN',
  COMMISSION_INVOICE: 'COM',
};

/** India financial year label, e.g. 2025-26 for Apr 2025 – Mar 2026 (Asia/Kolkata). */
export function indiaFinancialYear(issuedAt: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(issuedAt);
  const year = Number(parts.find((p) => p.type === 'year')?.value);
  const month = Number(parts.find((p) => p.type === 'month')?.value); // 1–12
  const startYear = month >= 4 ? year : year - 1;
  const endYearShort = String((startYear + 1) % 100).padStart(2, '0');
  return `${startYear}-${endYearShort}`;
}

/** Compact FY for invoice serials: 2025-26 → 2526 */
export function compactFinancialYear(financialYear: string): string {
  const [start, end] = financialYear.split('-');
  return `${String(start).slice(-2)}${String(end).padStart(2, '0')}`;
}

export function resolveInvoicePrefix(input: {
  invoicePrefix?: string | null;
  slug?: string | null;
  vendorId?: string | null;
}): string {
  const override = (input.invoicePrefix ?? '').trim().toUpperCase();
  if (override) {
    return override.replace(/[^A-Z0-9]/g, '').slice(0, 16) || PLATFORM_PREFIX;
  }
  const alnum = (input.slug ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (alnum.length >= 4) {
    const head = alnum.slice(0, 4);
    const tail = alnum.slice(-4);
    // Combine head+tail so shared slug prefixes (refund-vendor-*) stay unique.
    const combined = tail && tail !== head ? `${head}${tail}` : head;
    return combined.slice(0, 16);
  }
  if (input.vendorId) {
    return input.vendorId.replace(/-/g, '').slice(0, 8).toUpperCase() || PLATFORM_PREFIX;
  }
  return PLATFORM_PREFIX;
}

export function formatVendorDocumentNumber(
  prefix: string,
  financialYear: string,
  serial: number | string,
  kind: VendorDocumentKind = VENDOR_DOCUMENT_KIND.TAX_INVOICE,
): string {
  const value = typeof serial === 'string' ? BigInt(serial) : BigInt(serial);
  const padded = value.toString().padStart(SERIAL_WIDTH, '0');
  const fy = compactFinancialYear(financialYear);
  const infix = KIND_INFIX[kind];
  return infix
    ? `${prefix}/${infix}/${fy}/${padded}`
    : `${prefix}/${fy}/${padded}`;
}

/** @deprecated Prefer formatVendorDocumentNumber */
export function formatVendorTaxInvoiceNumber(
  prefix: string,
  financialYear: string,
  serial: number | string,
): string {
  return formatVendorDocumentNumber(
    prefix,
    financialYear,
    serial,
    VENDOR_DOCUMENT_KIND.TAX_INVOICE,
  );
}

async function lockOrCreateSequence(
  vendorId: string | null,
  financialYear: string,
  kind: VendorDocumentKind,
  prefix: string,
  transaction: Transaction,
): Promise<VendorInvoiceSequence> {
  const where =
    vendorId == null
      ? { vendorId: null, financialYear, kind }
      : { vendorId, financialYear, kind };

  let row = await VendorInvoiceSequence.findOne({
    where,
    transaction,
    lock: transaction.LOCK.UPDATE,
  });

  if (row) return row;

  try {
    row = await VendorInvoiceSequence.create(
      {
        vendorId,
        financialYear,
        kind,
        nextValue: 1,
        prefix,
      },
      { transaction },
    );
  } catch {
    row = await VendorInvoiceSequence.findOne({
      where,
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
  }

  if (!row) {
    throw new Error('Failed to allocate vendor document sequence');
  }
  return row;
}

/**
 * Allocate next number for a vendor document kind inside a transaction.
 * Tax invoice: `{PREFIX}/{FYcompact}/{8-digit}`
 * Credit/debit: `{PREFIX}/CN|DN/{FYcompact}/{8-digit}`
 * Commission (platform): `PLAT/COM/{FYcompact}/{8-digit}`
 */
export async function nextVendorDocumentNumber(
  vendorId: string | null,
  kind: VendorDocumentKind,
  issuedAt: Date,
  transaction: Transaction,
): Promise<{ number: string; issuedAt: Date }> {
  const financialYear = indiaFinancialYear(issuedAt);

  let prefix = PLATFORM_PREFIX;
  if (kind === VENDOR_DOCUMENT_KIND.COMMISSION_INVOICE) {
    prefix = PLATFORM_PREFIX;
  } else if (vendorId) {
    const vendor = await Vendor.findByPk(vendorId, {
      attributes: ['id', 'slug', 'invoicePrefix'],
      transaction,
      lock: transaction.LOCK.SHARE,
    });
    prefix = resolveInvoicePrefix({
      invoicePrefix: vendor?.invoicePrefix,
      slug: vendor?.slug,
      vendorId,
    });
    // Avoid cross-vendor collisions when slug/prefix are missing (all would be PLAT).
    if (prefix === PLATFORM_PREFIX) {
      prefix = vendorId.replace(/-/g, '').slice(0, 8).toUpperCase() || PLATFORM_PREFIX;
    }
  }

  // Commission invoices are platform-issued → always platform sequence row.
  const sequenceVendorId =
    kind === VENDOR_DOCUMENT_KIND.COMMISSION_INVOICE ? null : vendorId;

  const row = await lockOrCreateSequence(
    sequenceVendorId,
    financialYear,
    kind,
    prefix,
    transaction,
  );

  // Prefer freshly resolved prefix so vendors without slug don't all emit "PLAT/…".
  const seriesPrefix =
    kind === VENDOR_DOCUMENT_KIND.COMMISSION_INVOICE ? PLATFORM_PREFIX : prefix;
  const serial = Number(row.nextValue);
  const number = formatVendorDocumentNumber(
    seriesPrefix,
    financialYear,
    serial,
    kind,
  );

  await row.update(
    { nextValue: serial + 1, prefix: seriesPrefix },
    { transaction },
  );

  return { number, issuedAt };
}

export async function nextVendorTaxInvoiceNumber(
  vendorId: string | null,
  issuedAt: Date,
  transaction: Transaction,
): Promise<{ number: string; issuedAt: Date }> {
  return nextVendorDocumentNumber(
    vendorId,
    VENDOR_DOCUMENT_KIND.TAX_INVOICE,
    issuedAt,
    transaction,
  );
}

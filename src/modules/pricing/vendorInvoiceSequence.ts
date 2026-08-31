import type { Transaction } from 'sequelize';
import { Vendor } from '@database/models/vendor.model';
import { VendorInvoiceSequence } from '@database/models/vendorInvoiceSequence.model';

const PLATFORM_PREFIX = 'PLAT';
const SERIAL_WIDTH = 8;

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
}): string {
  const override = (input.invoicePrefix ?? '').trim().toUpperCase();
  if (override) {
    return override.replace(/[^A-Z0-9]/g, '').slice(0, 16) || PLATFORM_PREFIX;
  }
  const fromSlug = (input.slug ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 4);
  return fromSlug || PLATFORM_PREFIX;
}

export function formatVendorTaxInvoiceNumber(
  prefix: string,
  financialYear: string,
  serial: number | string,
): string {
  const value = typeof serial === 'string' ? BigInt(serial) : BigInt(serial);
  const padded = value.toString().padStart(SERIAL_WIDTH, '0');
  return `${prefix}/${compactFinancialYear(financialYear)}/${padded}`;
}

async function lockOrCreateSequence(
  vendorId: string | null,
  financialYear: string,
  prefix: string,
  transaction: Transaction,
): Promise<VendorInvoiceSequence> {
  const where =
    vendorId == null
      ? { vendorId: null, financialYear }
      : { vendorId, financialYear };

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
        nextValue: 1,
        prefix,
      },
      { transaction },
    );
  } catch {
    // Concurrent first-insert race — lock the winner.
    row = await VendorInvoiceSequence.findOne({
      where,
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
  }

  if (!row) {
    throw new Error('Failed to allocate vendor invoice sequence');
  }
  return row;
}

/**
 * Allocate next vendor-scoped GST tax invoice number inside a transaction.
 * Format: `{PREFIX}/{FYcompact}/{8-digit serial}` e.g. TW/2526/00000001
 */
export async function nextVendorTaxInvoiceNumber(
  vendorId: string | null,
  issuedAt: Date,
  transaction: Transaction,
): Promise<{ number: string; issuedAt: Date }> {
  const financialYear = indiaFinancialYear(issuedAt);

  let prefix = PLATFORM_PREFIX;
  if (vendorId) {
    const vendor = await Vendor.findByPk(vendorId, {
      attributes: ['id', 'slug', 'invoicePrefix'],
      transaction,
      lock: transaction.LOCK.SHARE,
    });
    prefix = resolveInvoicePrefix({
      invoicePrefix: vendor?.invoicePrefix,
      slug: vendor?.slug,
    });
  }

  const row = await lockOrCreateSequence(
    vendorId,
    financialYear,
    prefix,
    transaction,
  );

  // Prefer stored prefix if sequence already exists (stable series within FY).
  const seriesPrefix = row.prefix || prefix;
  const serial = Number(row.nextValue);
  const number = formatVendorTaxInvoiceNumber(
    seriesPrefix,
    financialYear,
    serial,
  );

  await row.update(
    { nextValue: serial + 1 },
    { transaction },
  );

  return { number, issuedAt };
}

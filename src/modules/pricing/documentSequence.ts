import type { Transaction } from 'sequelize';
import { DocumentSequence } from '@database/models/documentSequence.model';
import type { DocumentSequenceKind } from '@core/constants/statuses';
import { AppError } from '@core/errors/AppError';
import { ERROR_CODES, ERROR_MESSAGES } from '@core/constants/errors';
import { istDateString } from './istCalendar';

async function lockSequence(
  kind: DocumentSequenceKind,
  transaction: Transaction,
): Promise<DocumentSequence> {
  const row = await DocumentSequence.findOne({
    where: { kind },
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  if (!row) {
    throw new AppError(
      ERROR_MESSAGES.DOCUMENT_SEQUENCE_MISSING,
      500,
      ERROR_CODES.DOCUMENT_SEQUENCE_MISSING,
    );
  }
  return row;
}

/** Allocate next GST-style document number: PREFIX-YYYY-000001 */
export async function nextDocumentNumber(
  kind: DocumentSequenceKind,
  transaction: Transaction,
): Promise<string> {
  const row = await lockSequence(kind, transaction);
  const value = Number(row.nextValue);
  // The calendar year in India time (a number issued at 00:30 IST on 1 Jan is that year's).
  const year = istDateString(new Date()).slice(0, 4);
  const number = `${row.prefix}-${year}-${String(value).padStart(6, '0')}`;
  await row.update({ nextValue: value + 1 }, { transaction });
  return number;
}

/** Allocate next padded document number without year: PREFIX-000123 */
export async function nextPaddedDocumentNumber(
  kind: DocumentSequenceKind,
  transaction: Transaction,
): Promise<string> {
  const row = await lockSequence(kind, transaction);
  const value = Number(row.nextValue);
  const number = `${row.prefix}-${String(value).padStart(6, '0')}`;
  await row.update({ nextValue: value + 1 }, { transaction });
  return number;
}

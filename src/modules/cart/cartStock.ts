import { AppError } from '@core/errors/AppError';
import { ERROR_MESSAGES } from '@core/constants/errors';

/** 409 with the number left, instead of a misleading "Not found". */
export function assertStockFor(quantity: number, stock: number): void {
  if (stock <= 0) {
    throw new AppError(ERROR_MESSAGES.OUT_OF_STOCK, 409, 'OUT_OF_STOCK', { available: 0 });
  }
  if (quantity > stock) {
    throw new AppError(`Only ${stock} left in stock`, 409, 'INSUFFICIENT_STOCK', { available: stock });
  }
}

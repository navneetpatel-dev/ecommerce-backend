import { AppError } from './AppError';
import { ERROR_CODES } from '@core/constants/errors';

export class ValidationError extends AppError {
  constructor(details: unknown) {
    // Call sites pass either a human-readable string or field-level details.
    const message = typeof details === 'string' ? details : 'Validation failed';
    super(
      message,
      422,
      ERROR_CODES.VALIDATION_ERROR,
      typeof details === 'string' ? undefined : details,
    );
  }
}

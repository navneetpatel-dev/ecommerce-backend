import { AppError } from './AppError';
import { ERROR_CODES } from '@core/constants/errors';

export class ValidationError extends AppError {
  constructor(details: unknown) {
    super('Validation failed', 422, ERROR_CODES.VALIDATION_ERROR, details);
  }
}

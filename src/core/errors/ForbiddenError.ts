import { AppError } from './AppError';
import { ERROR_CODES } from '@core/constants/errors';

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(message, 403, ERROR_CODES.FORBIDDEN);
  }
}

import { AppError } from './AppError';
import { ERROR_CODES } from '@core/constants/errors';

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(`${resource} not found`, 404, ERROR_CODES.NOT_FOUND);
  }
}

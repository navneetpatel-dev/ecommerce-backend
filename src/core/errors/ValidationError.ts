import { AppError } from './AppError';

export class ValidationError extends AppError {
  constructor(details: unknown) {
    super('Validation failed', 422, 'VALIDATION_ERROR', details);
  }
}

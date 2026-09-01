import { AppError } from './AppError';
import { ERROR_CODES } from '@core/constants/errors';
import {
  normalizeValidationDetails,
  validationDetailsMessage,
  type ValidationErrorDetails,
} from '@core/http/validationErrorDetails';

export class ValidationError extends AppError {
  readonly validationDetails: ValidationErrorDetails;

  constructor(details: unknown) {
    const validationDetails = normalizeValidationDetails(details);
    const message = validationDetailsMessage(validationDetails);

    super(message, 422, ERROR_CODES.VALIDATION_ERROR, validationDetails);
    this.validationDetails = validationDetails;
  }
}

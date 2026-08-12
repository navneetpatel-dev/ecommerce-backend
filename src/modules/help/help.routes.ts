import { Router } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { AppError } from '@core/errors/AppError';
import { ERROR_CODES, ERROR_MESSAGES } from '@core/constants/errors';
import { authenticate, optionalAuthenticate } from '@middleware/auth.middleware';

const router = Router();

/** Legacy contact-form API — replaced by Support Tickets (`/api/support-tickets`). */
function legacyHelpGone(): never {
  throw new AppError(
    ERROR_MESSAGES.HELP_LEGACY_REPLACED,
    410,
    ERROR_CODES.HELP_LEGACY_REPLACED,
  );
}

router.post(
  '/tickets',
  optionalAuthenticate,
  asyncHandler(async () => {
    legacyHelpGone();
  }),
);

router.get(
  '/tickets/mine',
  authenticate,
  asyncHandler(async () => {
    legacyHelpGone();
  }),
);

export default router;

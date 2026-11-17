import { Request, Response, NextFunction } from 'express';
import { AppError } from '@core/errors/AppError';
import { ROLES } from '@core/constants/statuses';
import { roleNameOf } from '@utils/userRole';
import { settingsService } from '@modules/settings/settings.service';

export const MAINTENANCE_ERROR_CODE = 'MAINTENANCE_MODE';

const DEFAULT_MESSAGE = 'The store is under maintenance right now. Please try again shortly.';

/**
 * Maintenance mode (Platform Settings) is not only a storefront page: while it is on, shoppers
 * cannot start new orders, wallet top-ups or gift-card purchases through the API either, so a
 * tab opened before maintenance began cannot slip a purchase through. Staff (admin, vendor)
 * pass so the store can be verified, and payment verification/cancel routes are left alone so
 * an in-flight payment still completes.
 */
export async function blockNewPurchasesDuringMaintenance(req: Request, _res: Response, next: NextFunction) {
  try {
    if (req.user && roleNameOf(req.user) !== ROLES.CUSTOMER) return next();
    const settings = await settingsService.getPlatformSettings();
    if (!settings.maintenanceEnabled) return next();
    const message = settings.maintenanceMessage?.trim() || DEFAULT_MESSAGE;
    return next(new AppError(message, 503, MAINTENANCE_ERROR_CODE));
  } catch (error) {
    return next(error);
  }
}

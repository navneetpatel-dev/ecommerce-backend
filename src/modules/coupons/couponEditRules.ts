import { Op } from 'sequelize';
import { Coupon } from '@database/models/coupon.model';
import { AppError } from '@core/errors/AppError';
import { ValidationError } from '@core/errors/ValidationError';
import { ERROR_CODES, ERROR_MESSAGES } from '@core/constants/errors';
import { coerceRupees } from '@modules/pricing/money';
import { CouponRulesSchema, type UpdateCouponRequest } from './coupons.dto';

/** Codes are unique across every coupon, deleted ones included (the column is unique). */
export async function assertCouponCodeFree(code: string, exceptId?: string): Promise<void> {
  const taken = await Coupon.findOne({
    where: { code: code.toUpperCase(), ...(exceptId ? { id: { [Op.ne]: exceptId } } : {}) },
    attributes: ['id'],
    paranoid: false,
  });
  if (taken) throw new AppError(ERROR_MESSAGES.COUPON_CODE_EXISTS, 409, ERROR_CODES.COUPON_CODE_EXISTS);
}

/**
 * What an edit may change. Once a coupon has been used, what it *is* stays fixed — its
 * code, type, who bears the discount and whose coupon it is — so orders that used it keep
 * meaning what they meant; limits, dates, value, minimums and wording stay editable. The
 * whole coupon (stored values + the patch) must still pass the create-time rules.
 */
export async function assertCouponEditAllowed(
  coupon: Coupon,
  dto: UpdateCouponRequest,
  opts: { vendorScoped: boolean },
): Promise<void> {
  const used = Number(coupon.usedCount ?? 0);
  const fieldErrors: Record<string, string[]> = {};
  if (used > 0) {
    const locked = ERROR_MESSAGES.COUPON_FIELD_LOCKED_AFTER_USE;
    if (dto.code != null && dto.code.toUpperCase() !== coupon.code) fieldErrors.code = [locked];
    if (dto.type != null && dto.type !== coupon.type) fieldErrors.type = [locked];
    if (!opts.vendorScoped) {
      if (dto.discountBearer != null && dto.discountBearer !== coupon.discountBearer) fieldErrors.discountBearer = [locked];
      if (dto.vendorId !== undefined && (dto.vendorId ?? null) !== (coupon.vendorId ?? null)) fieldErrors.vendorId = [locked];
    }
  }
  if (dto.usageLimitTotal != null && dto.usageLimitTotal < used) {
    fieldErrors.usageLimitTotal = [ERROR_MESSAGES.COUPON_USAGE_LIMIT_BELOW_USED.replace('{used}', String(used))];
  }
  if (Object.keys(fieldErrors).length) throw new ValidationError({ fieldErrors, formErrors: [] });

  const merged = CouponRulesSchema.safeParse({
    type: dto.type ?? coupon.type,
    value: dto.value !== undefined ? dto.value : coupon.value == null ? null : coerceRupees(coupon.value),
    startDate: dto.startDate ?? coupon.startDate.toISOString(),
    endDate: dto.endDate ?? coupon.endDate.toISOString(),
    config: dto.config !== undefined ? dto.config : (coupon.config ?? undefined),
  });
  if (!merged.success) throw new ValidationError(merged.error.flatten());

  if (dto.code != null && dto.code.toUpperCase() !== coupon.code) await assertCouponCodeFree(dto.code, coupon.id);
}

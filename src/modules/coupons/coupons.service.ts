import { Coupon } from '@database/models/coupon.model';
import { CouponUsage } from '@database/models/couponUsage.model';
import { Cart } from '@database/models/cart.model';
import { CartItem } from '@database/models/cartItem.model';
import { ProductVariant } from '@database/models/productVariant.model';
import { Product } from '@database/models/product.model';
import { Vendor } from '@database/models/vendor.model';
import { NotFoundError } from '@core/errors/NotFoundError';
import { ValidationError } from '@core/errors/ValidationError';
import { AppError } from '@core/errors/AppError';
import type { CreateCouponRequest } from './coupons.dto';
import { COUPON_STATUS, VENDOR_STATUS } from '@core/constants/statuses';
import { ERROR_CODES, ERROR_MESSAGES } from '@core/constants/errors';
import { resolveItemAvailability } from '@core/catalog/customerVisibility';
import { buildPaginationMeta, paginationOffset } from '@core/http/pagination';

function computePreviewDiscount(coupon: Coupon, subtotal: number): number {
  const value = Number(coupon.value ?? 0);
  if (coupon.type === 'PERCENTAGE') {
    return Math.min(
      (subtotal * value) / 100,
      Number(coupon.maxDiscountCap ?? Infinity),
    );
  }
  if (coupon.type === 'FLAT') {
    return Math.min(value, subtotal);
  }
  return 0;
}

async function assertCouponVendorAvailable(coupon: Coupon) {
  if (!coupon.vendorId) return;
  const vendor = await Vendor.findByPk(coupon.vendorId);
  if (!vendor || vendor.status !== VENDOR_STATUS.APPROVED) {
    throw new AppError(ERROR_MESSAGES.VENDOR_UNAVAILABLE, 422, ERROR_CODES.VENDOR_UNAVAILABLE);
  }
}

export const couponsService = {
  async createCoupon(dto: CreateCouponRequest, actorId: string) {
    return Coupon.create({
      ...dto,
      code: dto.code.toUpperCase(),
      status: COUPON_STATUS.ACTIVE,
      startDate: new Date(dto.startDate),
      endDate: new Date(dto.endDate),
      createdById: actorId,
    });
  },

  async listCoupons(query: { page: number; limit: number }) {
    const offset = paginationOffset(query.page, query.limit);
    const { rows, count } = await Coupon.findAndCountAll({
      order: [['createdAt', 'DESC']],
      limit: query.limit,
      offset,
    });
    return {
      coupons: rows,
      pagination: buildPaginationMeta(count, query.page, query.limit),
    };
  },

  async applyCoupon(code: string, userId: string) {
    const coupon = await Coupon.findOne({
      where: { code: code.toUpperCase(), status: COUPON_STATUS.ACTIVE },
    });
    const now = new Date();
    if (!coupon || coupon.startDate > now || coupon.endDate < now) {
      throw new NotFoundError('Coupon');
    }
    await assertCouponVendorAvailable(coupon);

    if (coupon.usageLimitTotal != null && (coupon.usedCount ?? 0) >= coupon.usageLimitTotal) {
      throw new ValidationError(ERROR_MESSAGES.COUPON_USAGE_LIMIT);
    }
    if (coupon.usageLimitPerUser != null) {
      const userUsage = await CouponUsage.count({ where: { couponId: coupon.id, userId } });
      if (userUsage >= coupon.usageLimitPerUser) {
        throw new ValidationError(ERROR_MESSAGES.COUPON_USAGE_LIMIT);
      }
    }

    const cart = await Cart.findOne({
      where: { userId },
      include: [
        {
          model: CartItem,
          as: 'items',
          include: [{
            model: ProductVariant,
            as: 'variant',
            include: [{ model: Product, as: 'product', include: [{ model: Vendor, as: 'vendor' }] }],
          }],
        },
      ],
    });
    const items = ((cart as any)?.items ?? []).filter((item: any) => {
      const product = item.variant?.product;
      const vendor = product?.vendor ?? product?.Vendor ?? null;
      return resolveItemAvailability({
        product,
        vendor,
        stock: Number(item.variant?.stock ?? 0),
        quantity: Number(item.quantity ?? 0),
      }).isAvailable;
    });
    const subtotal = items.reduce(
      (sum: number, item: any) =>
        sum + Number(item.variant?.price ?? 0) * Number(item.quantity ?? 0),
      0,
    );

    if (coupon.minOrderValue != null && subtotal < Number(coupon.minOrderValue)) {
      throw new ValidationError(`Minimum order value is ${coupon.minOrderValue}`);
    }

    const discount = Math.max(
      0,
      Math.round(computePreviewDiscount(coupon, subtotal) * 100) / 100,
    );

    return { code: coupon.code, discount, type: coupon.type };
  },
};

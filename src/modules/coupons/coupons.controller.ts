import { Request, Response } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { ERROR_MESSAGES } from '@core/constants/errors';
import { VENDOR_ROLES } from '@core/constants/statuses';
import { couponsService } from './coupons.service';
import {
  CreateCouponSchema,
  UpdateCouponSchema,
  ApplyCouponSchema,
  BulkGenerateSchema,
  ListCouponsQuerySchema,
  StatusSchema,
  EligibleCouponsQuerySchema,
  PublicEligibleCouponsQuerySchema,
  RemoveCouponQuerySchema,
} from './coupons.dto';

function isVendorActor(req: Request): boolean {
  const role = req.user?.role?.name;
  return !!role && (VENDOR_ROLES as readonly string[]).includes(role);
}

function requireVendorId(req: Request): string {
  if (!req.user?.vendorId) {
    throw new ForbiddenError(ERROR_MESSAGES.AUTH_REQUIRED);
  }
  return req.user.vendorId;
}

function vendorScope(req: Request): { forceVendorId?: string | null } {
  if (isVendorActor(req)) {
    return { forceVendorId: requireVendorId(req) };
  }
  return {};
}

export const createCoupon = asyncHandler(async (req: Request, res: Response) => {
  const dto = CreateCouponSchema.parse(req.body);
  const opts = vendorScope(req);
  const coupon = await couponsService.createCoupon(dto, req.user!.id, opts);
  res.status(201).json(ok(coupon));
});

export const updateCoupon = asyncHandler(async (req: Request, res: Response) => {
  const dto = UpdateCouponSchema.parse(req.body);
  const coupon = await couponsService.updateCoupon(req.params.id!, dto, req.user!.id, vendorScope(req));
  res.json(ok(coupon));
});

export const listCoupons = asyncHandler(async (req: Request, res: Response) => {
  const query = ListCouponsQuerySchema.parse(req.query);
  const result = await couponsService.listCoupons(query, vendorScope(req));
  res.json(ok(result.coupons, { pagination: result.pagination }));
});

export const getCoupon = asyncHandler(async (req: Request, res: Response) => {
  const coupon = await couponsService.getById(req.params.id!, vendorScope(req));
  res.json(ok(coupon));
});

export const couponAnalytics = asyncHandler(async (req: Request, res: Response) => {
  const analytics = await couponsService.analytics(req.params.id!, vendorScope(req));
  res.json(ok(analytics));
});

export const setCouponStatus = asyncHandler(async (req: Request, res: Response) => {
  const dto = StatusSchema.parse(req.body);
  const coupon = await couponsService.setStatus(req.params.id!, dto, req.user!.id, vendorScope(req));
  res.json(ok(coupon));
});

export const bulkGenerate = asyncHandler(async (req: Request, res: Response) => {
  const dto = BulkGenerateSchema.parse(req.body);
  const result = await couponsService.bulkGenerate(dto, req.user!.id, vendorScope(req));
  res.status(201).json(ok(result));
});

export const listBatches = asyncHandler(async (req: Request, res: Response) => {
  const batches = await couponsService.listBatches(vendorScope(req));
  res.json(ok(batches));
});

export const runCouponAlertJob = asyncHandler(async (_req: Request, res: Response) => {
  const result = await couponsService.notifyExpiringAndNearLimit();
  res.json(ok(result));
});

export const applyCoupon = asyncHandler(async (req: Request, res: Response) => {
  const { code } = ApplyCouponSchema.parse(req.body);
  const result = await couponsService.applyCoupon(code, req.user!.id);
  res.json(ok(result));
});

export const removeCoupon = asyncHandler(async (req: Request, res: Response) => {
  const { code } = RemoveCouponQuerySchema.parse(req.query);
  const result = await couponsService.removeCoupon(req.user!.id, code);
  res.json(ok(result));
});

export const eligibleCoupons = asyncHandler(async (req: Request, res: Response) => {
  const query = EligibleCouponsQuerySchema.parse(req.query);
  const result = await couponsService.eligibleCoupons(req.user!.id, {
    productId: query.productId,
    limit: query.limit,
  });
  res.json(ok(result));
});

export const eligibleCouponsPublic = asyncHandler(async (req: Request, res: Response) => {
  const query = PublicEligibleCouponsQuerySchema.parse(req.query);
  const result = await couponsService.eligibleCoupons(null, {
    productId: query.productId,
    limit: query.limit,
  });
  res.json(ok(result));
});

/** Vendor create — same handler; route uses authenticate + vendor role gate. */
export const createVendorCoupon = asyncHandler(async (req: Request, res: Response) => {
  if (!isVendorActor(req)) {
    throw new ForbiddenError(ERROR_MESSAGES.AUTH_REQUIRED);
  }
  const dto = CreateCouponSchema.parse(req.body);
  const coupon = await couponsService.createCoupon(dto, req.user!.id, {
    forceVendorId: requireVendorId(req),
  });
  res.status(201).json(ok(coupon));
});

export const listVendorCoupons = asyncHandler(async (req: Request, res: Response) => {
  if (!isVendorActor(req)) {
    throw new ForbiddenError(ERROR_MESSAGES.AUTH_REQUIRED);
  }
  const query = ListCouponsQuerySchema.parse(req.query);
  const result = await couponsService.listCoupons(query, { forceVendorId: requireVendorId(req) });
  res.json(ok(result.coupons, { pagination: result.pagination }));
});

export const vendorAbsorbedSummary = asyncHandler(async (req: Request, res: Response) => {
  if (!isVendorActor(req)) {
    throw new ForbiddenError(ERROR_MESSAGES.AUTH_REQUIRED);
  }
  const summary = await couponsService.vendorAbsorbedDiscountSummary(requireVendorId(req));
  res.json(ok(summary));
});

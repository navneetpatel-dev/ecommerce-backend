import { Request, Response } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { ROLES } from '@core/constants/statuses';
import { AddStaffSchema } from './vendorStaff.dto';
import { vendorStaffService } from './vendorStaff.service';

function assertCanManageStaff(user: any) {
  if (!user?.vendorId) throw new ForbiddenError('Vendor account required');
  const roleName = user.role?.name;
  if (roleName !== ROLES.VENDOR_OWNER && roleName !== ROLES.SUPER_ADMIN) {
    throw new ForbiddenError('Only the store owner or administrator can manage team members');
  }
}

export const listStaff = asyncHandler(async (req: Request, res: Response) => {
  assertCanManageStaff(req.user);
  const staff = await vendorStaffService.listStaff(req.user!.vendorId!);
  res.json(ok(staff));
});

export const addStaff = asyncHandler(async (req: Request, res: Response) => {
  assertCanManageStaff(req.user);
  const data = AddStaffSchema.parse(req.body);
  const member = await vendorStaffService.addStaff(req.user!.vendorId!, data, req.user!.id);
  res.status(201).json(ok(member));
});

export const removeStaff = asyncHandler(async (req: Request, res: Response) => {
  assertCanManageStaff(req.user);
  const result = await vendorStaffService.removeStaff(req.user!.vendorId!, req.params.userId!, req.user!.id);
  res.json(ok(result));
});

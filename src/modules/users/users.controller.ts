import { Request, Response } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { usersService } from './users.service';
import { UpdateUserProfileSchema, GetUsersQuerySchema, UpdateUserStatusSchema } from './users.dto';

export const getProfile = asyncHandler(async (req: Request, res: Response) => {
  const user = await usersService.getProfile(req.user!.id);
  res.json(ok(user));
});

export const updateProfile = asyncHandler(async (req: Request, res: Response) => {
  const dto = UpdateUserProfileSchema.parse(req.body);
  const user = await usersService.updateProfile(req.user!.id, dto);
  res.json(ok(user));
});

export const getUsers = asyncHandler(async (req: Request, res: Response) => {
  const query = GetUsersQuerySchema.parse(req.query);
  const result = await usersService.getUsers(query);
  res.json(ok(result.users, { pagination: result.pagination }));
});

export const getUserById = asyncHandler(async (req: Request, res: Response) => {
  const user = await usersService.getUserById(req.params.id!);
  res.json(ok(user));
});

export const updateUserStatus = asyncHandler(async (req: Request, res: Response) => {
  const dto = UpdateUserStatusSchema.parse(req.body);
  const user = await usersService.updateUserStatus(req.params.id!, dto);
  res.json(ok(user));
});

export const deleteUser = asyncHandler(async (req: Request, res: Response) => {
  await usersService.deleteUser(req.params.id!);
  res.status(204).send();
});

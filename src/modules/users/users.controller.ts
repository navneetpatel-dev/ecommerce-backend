import { Request, Response } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { usersService } from './users.service';
import {
  UpdateUserProfileSchema,
  GetUsersQuerySchema,
  UpdateUserStatusSchema,
  CreateAddressSchema,
  UpdateAddressSchema,
  ListAssigneesQuerySchema,
} from './users.dto';

export const getProfile = asyncHandler(async (req: Request, res: Response) => {
  const user = await usersService.getProfile(req.user!.id);
  res.json(ok(user));
});

export const updateProfile = asyncHandler(async (req: Request, res: Response) => {
  const dto = UpdateUserProfileSchema.parse(req.body);
  const user = await usersService.updateProfile(req.user!.id, dto);
  res.json(ok(user));
});

export const exportAccount = asyncHandler(async (req: Request, res: Response) => {
  const data = await usersService.exportAccountData(req.user!.id);
  res.json(ok(data));
});

export const listAddresses = asyncHandler(async (req: Request, res: Response) => {
  const addresses = await usersService.listAddresses(req.user!.id);
  res.json(ok(addresses));
});

export const createAddress = asyncHandler(async (req: Request, res: Response) => {
  const dto = CreateAddressSchema.parse(req.body);
  const address = await usersService.createAddress(req.user!.id, dto);
  res.status(201).json(ok(address));
});

export const updateAddress = asyncHandler(async (req: Request, res: Response) => {
  const dto = UpdateAddressSchema.parse(req.body);
  const address = await usersService.updateAddress(req.user!.id, req.params.addressId!, dto);
  res.json(ok(address));
});

export const deleteAddress = asyncHandler(async (req: Request, res: Response) => {
  await usersService.deleteAddress(req.user!.id, req.params.addressId!);
  res.status(204).send();
});

export const setDefaultAddress = asyncHandler(async (req: Request, res: Response) => {
  const address = await usersService.setDefaultAddress(req.user!.id, req.params.addressId!);
  res.json(ok(address));
});

export const deleteOwnAccount = asyncHandler(async (req: Request, res: Response) => {
  await usersService.deleteOwnAccount(req.user!.id);
  res.status(204).send();
});

export const getUsers = asyncHandler(async (req: Request, res: Response) => {
  const query = GetUsersQuerySchema.parse(req.query);
  const result = await usersService.getUsers(query);
  res.json(ok(result.users, { pagination: result.pagination }));
});

export const listAssignees = asyncHandler(async (req: Request, res: Response) => {
  const query = ListAssigneesQuerySchema.parse(req.query);
  const result = await usersService.listAssignees(req.user!, query);
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

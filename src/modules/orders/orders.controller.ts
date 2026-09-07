import { Request, Response } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { PERMISSIONS } from '@core/permissions/permissionKeys';
import { userHasPermission } from '@middleware/rbac.middleware';
import { ordersService } from './orders.service';
import { CreateOrderSchema, GetOrdersQuerySchema, UpdateOrderStatusSchema } from './orders.dto';

export const createOrder = asyncHandler(async (req: Request, res: Response) => {
  const dto = CreateOrderSchema.parse(req.body);
  const order = await ordersService.createOrder(req.user!.id, dto);
  res.status(201).json(ok(order));
});

export const getOrders = asyncHandler(async (req: Request, res: Response) => {
  const query = GetOrdersQuerySchema.parse(req.query);
  const isAdmin = await userHasPermission(req.user, PERMISSIONS.ORDER_MANAGE);
  const result = await ordersService.getOrders(isAdmin ? query.userId ?? null : req.user!.id, query);
  res.json(ok(result.orders, { pagination: result.pagination }));
});

export const getOrderById = asyncHandler(async (req: Request, res: Response) => {
  const isAdmin = await userHasPermission(req.user, PERMISSIONS.ORDER_MANAGE);
  const order = await ordersService.getOrderById(req.params.id!, isAdmin ? undefined : req.user!.id);
  res.json(ok(order));
});

export const updateOrderStatus = asyncHandler(async (req: Request, res: Response) => {
  const dto = UpdateOrderStatusSchema.parse(req.body);
  const order = await ordersService.updateOrderStatus(req.params.id!, dto.status, req.user!.id);
  res.json(ok(order));
});

export const cancelOrder = asyncHandler(async (req: Request, res: Response) => {
  const isAdmin = await userHasPermission(req.user, PERMISSIONS.ORDER_MANAGE);
  const result = await ordersService.cancelPaidOrder(req.params.id!, req.user!.id, isAdmin);
  res.json(ok(result));
});

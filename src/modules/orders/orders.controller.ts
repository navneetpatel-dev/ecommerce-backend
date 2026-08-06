import { Request, Response } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { ordersService } from './orders.service';
import { CreateOrderSchema, GetOrdersQuerySchema, UpdateOrderStatusSchema } from './orders.dto';

export const createOrder = asyncHandler(async (req: Request, res: Response) => {
  const dto = CreateOrderSchema.parse(req.body);
  const order = await ordersService.createOrder(req.user!.id, dto);
  res.status(201).json(ok(order));
});

export const getOrders = asyncHandler(async (req: Request, res: Response) => {
  const query = GetOrdersQuerySchema.parse(req.query);
  const isAdmin = ['SUPER_ADMIN', 'ADMIN_ORDER_MANAGER', 'ADMIN_CATALOG_MANAGER'].includes(req.user!.role.name);
  const result = await ordersService.getOrders(isAdmin ? null : req.user!.id, query);
  res.json(ok(result.orders, { pagination: result.pagination }));
});

export const getOrderById = asyncHandler(async (req: Request, res: Response) => {
  const isAdmin = ['SUPER_ADMIN', 'ADMIN_ORDER_MANAGER', 'ADMIN_CATALOG_MANAGER'].includes(req.user!.role.name);
  const order = await ordersService.getOrderById(req.params.id!, isAdmin ? undefined : req.user!.id);
  res.json(ok(order));
});

export const updateOrderStatus = asyncHandler(async (req: Request, res: Response) => {
  const dto = UpdateOrderStatusSchema.parse(req.body);
  const order = await ordersService.updateOrderStatus(req.params.id!, dto.status);
  res.json(ok(order));
});

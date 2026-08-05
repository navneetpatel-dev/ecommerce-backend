import { Request, Response } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { cartService } from './cart.service';
import { AddToCartSchema, UpdateCartItemSchema } from './cart.dto';

export const getCart = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id ?? null;
  const sessionId = req.cookies.sessionId ?? null;
  const cart = await cartService.getCart(userId, sessionId);
  res.json(ok(cart));
});

export const addToCart = asyncHandler(async (req: Request, res: Response) => {
  const dto = AddToCartSchema.parse(req.body);
  const userId = req.user?.id ?? null;
  const sessionId = req.cookies.sessionId ?? null;
  const cart = await cartService.addToCart(userId, sessionId, dto);
  res.status(201).json(ok(cart));
});

export const updateCartItem = asyncHandler(async (req: Request, res: Response) => {
  const dto = UpdateCartItemSchema.parse(req.body);
  const userId = req.user?.id ?? null;
  const sessionId = req.cookies.sessionId ?? null;
  const cart = await cartService.updateCartItem(userId, sessionId, req.params.itemId!, dto);
  res.json(ok(cart));
});

export const removeFromCart = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id ?? null;
  const sessionId = req.cookies.sessionId ?? null;
  const cart = await cartService.removeFromCart(userId, sessionId, req.params.itemId!);
  res.json(ok(cart));
});

export const clearCart = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id ?? null;
  const sessionId = req.cookies.sessionId ?? null;
  await cartService.clearCart(userId, sessionId);
  res.status(204).send();
});

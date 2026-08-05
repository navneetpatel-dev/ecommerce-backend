import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { cartService } from './cart.service';
import { AddToCartSchema, UpdateCartItemSchema } from './cart.dto';

const SESSION_COOKIE = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 30 * 24 * 60 * 60 * 1000,
};

function resolveCartIdentity(req: Request, res: Response) {
  const userId = req.user?.id ?? null;
  let sessionId = (req.cookies?.sessionId as string | undefined) ?? null;

  if (!userId && !sessionId) {
    sessionId = randomUUID();
    res.cookie('sessionId', sessionId, SESSION_COOKIE);
  }

  return { userId, sessionId };
}

export const getCart = asyncHandler(async (req: Request, res: Response) => {
  const { userId, sessionId } = resolveCartIdentity(req, res);
  const cart = await cartService.getCart(userId, sessionId);
  res.json(ok(cart));
});

export const addToCart = asyncHandler(async (req: Request, res: Response) => {
  const dto = AddToCartSchema.parse(req.body);
  const { userId, sessionId } = resolveCartIdentity(req, res);
  const cart = await cartService.addToCart(userId, sessionId, dto);
  res.status(201).json(ok(cart));
});

export const updateCartItem = asyncHandler(async (req: Request, res: Response) => {
  const dto = UpdateCartItemSchema.parse(req.body);
  const { userId, sessionId } = resolveCartIdentity(req, res);
  const cart = await cartService.updateCartItem(userId, sessionId, req.params.itemId!, dto);
  res.json(ok(cart));
});

export const removeFromCart = asyncHandler(async (req: Request, res: Response) => {
  const { userId, sessionId } = resolveCartIdentity(req, res);
  const cart = await cartService.removeFromCart(userId, sessionId, req.params.itemId!);
  res.json(ok(cart));
});

export const clearCart = asyncHandler(async (req: Request, res: Response) => {
  const { userId, sessionId } = resolveCartIdentity(req, res);
  await cartService.clearCart(userId, sessionId);
  res.status(204).send();
});

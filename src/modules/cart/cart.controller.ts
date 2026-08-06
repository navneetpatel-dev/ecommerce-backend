import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { cartService } from './cart.service';
import { AddToCartSchema, UpdateCartItemSchema } from './cart.dto';
import { COOKIES, GUEST_SESSION_TTL_MS } from '@core/constants/http';

const SESSION_COOKIE = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: GUEST_SESSION_TTL_MS,
};

function clearGuestSessionCookie(res: Response) {
  // Clear both httpOnly (current) and any legacy non-httpOnly cookie from older clients.
  const base = {
    path: '/',
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
  };
  res.clearCookie(COOKIES.SESSION_ID, { ...base, httpOnly: true });
  res.clearCookie(COOKIES.SESSION_ID, base);
}

function resolveCartIdentity(
  req: Request,
  res: Response,
  options: { mintGuestSession?: boolean } = {},
) {
  const mintGuestSession = options.mintGuestSession !== false;
  const userId = req.user?.id ?? null;
  let sessionId = (req.cookies?.[COOKIES.SESSION_ID] as string | undefined) ?? null;

  // Guests need a stable anonymous id on mutating routes. Reads should not mint a new
  // empty guest cart (e.g. unauthenticated refresh after login cleared the old cookie).
  if (!userId && !sessionId && mintGuestSession) {
    sessionId = randomUUID();
    res.cookie(COOKIES.SESSION_ID, sessionId, SESSION_COOKIE);
  }

  return { userId, sessionId };
}

/**
 * If the browser still has a leftover guest cookie after login, merge once then drop the cookie
 * so subsequent cart reads skip the guest lookup entirely.
 */
async function absorbGuestCartIfNeeded(
  req: Request,
  res: Response,
  userId: string | null,
  sessionId: string | null,
) {
  if (!userId || !sessionId) return;
  await cartService.mergeGuestCartIfPresent(sessionId, userId);
  clearGuestSessionCookie(res);
}

export const getCart = asyncHandler(async (req: Request, res: Response) => {
  const { userId, sessionId } = resolveCartIdentity(req, res, { mintGuestSession: false });
  await absorbGuestCartIfNeeded(req, res, userId, sessionId);
  const cart = await cartService.getCart(userId, userId ? null : sessionId);
  res.json(ok(cart));
});

export const mergeGuestCart = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const sessionId = (req.cookies?.[COOKIES.SESSION_ID] as string | undefined) ?? null;

  if (sessionId) {
    await cartService.mergeGuestCartIfPresent(sessionId, userId);
    clearGuestSessionCookie(res);
  }

  const cart = await cartService.getCart(userId, null);
  res.json(ok(cart));
});

export const addToCart = asyncHandler(async (req: Request, res: Response) => {
  const dto = AddToCartSchema.parse(req.body);
  const { userId, sessionId } = resolveCartIdentity(req, res);
  await absorbGuestCartIfNeeded(req, res, userId, sessionId);
  const cart = await cartService.addToCart(userId, userId ? null : sessionId, dto);
  res.status(201).json(ok(cart));
});

export const updateCartItem = asyncHandler(async (req: Request, res: Response) => {
  const dto = UpdateCartItemSchema.parse(req.body);
  const { userId, sessionId } = resolveCartIdentity(req, res);
  await absorbGuestCartIfNeeded(req, res, userId, sessionId);
  const cart = await cartService.updateCartItem(
    userId,
    userId ? null : sessionId,
    req.params.itemId!,
    dto,
  );
  res.json(ok(cart));
});

export const removeFromCart = asyncHandler(async (req: Request, res: Response) => {
  const { userId, sessionId } = resolveCartIdentity(req, res);
  await absorbGuestCartIfNeeded(req, res, userId, sessionId);
  const cart = await cartService.removeFromCart(
    userId,
    userId ? null : sessionId,
    req.params.itemId!,
  );
  res.json(ok(cart));
});

export const clearCart = asyncHandler(async (req: Request, res: Response) => {
  const { userId, sessionId } = resolveCartIdentity(req, res);
  await absorbGuestCartIfNeeded(req, res, userId, sessionId);
  await cartService.clearCart(userId, userId ? null : sessionId);
  res.status(204).send();
});

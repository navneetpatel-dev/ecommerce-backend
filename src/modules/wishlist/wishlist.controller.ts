import { Request, Response } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { wishlistService } from './wishlist.service';
import type { AddToWishlistRequest } from './wishlist.dto';

export const listWishlist = asyncHandler(async (req: Request, res: Response) => {
  const wishlist = await wishlistService.getWishlist(req.user!.id);
  res.json(ok(wishlist));
});

export const addToWishlist = asyncHandler(async (req: Request, res: Response) => {
  // Body was validated and normalised by the validate(AddToWishlistSchema)
  // middleware in the route chain — no second parse here.
  const { productId } = req.body as AddToWishlistRequest;
  const item = await wishlistService.addToWishlist(req.user!.id, productId);
  res.status(201).json(ok(item));
});

export const removeFromWishlist = asyncHandler(async (req: Request, res: Response) => {
  await wishlistService.removeFromWishlist(req.user!.id, req.params.productId!);
  res.status(204).send();
});

export const moveToCart = asyncHandler(async (req: Request, res: Response) => {
  const cartItem = await wishlistService.moveToCart(req.user!.id, req.params.productId!);
  res.json(ok(cartItem));
});

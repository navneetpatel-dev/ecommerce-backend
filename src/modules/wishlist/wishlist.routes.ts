// Wishlist module - User wishlist management
import { Router } from 'express';
import { authenticate } from '@middleware/auth.middleware';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { z } from 'zod';
import { validate } from '@middleware/validate.middleware';
import { wishlistService } from './wishlist.service';

const AddToWishlistSchema = z.object({
  productId: z.string().uuid(),
});

const router = Router();

router.get('/', authenticate, asyncHandler(async (req, res) => {
  const wishlist = await wishlistService.getWishlist(req.user!.id);
  res.json(ok(wishlist));
}));

router.post('/items', authenticate, validate(AddToWishlistSchema), asyncHandler(async (req, res) => {
  const { productId } = AddToWishlistSchema.parse(req.body);
  const item = await wishlistService.addToWishlist(req.user!.id, productId);
  res.status(201).json(ok(item));
}));

router.delete('/items/:productId', authenticate, asyncHandler(async (req, res) => {
  await wishlistService.removeFromWishlist(req.user!.id, req.params.productId!);
  res.status(204).send();
}));

router.post('/items/:productId/move-to-cart', authenticate, asyncHandler(async (req, res) => {
  const cartItem = await wishlistService.moveToCart(req.user!.id, req.params.productId!);
  res.json(ok(cartItem));
}));

export default router;

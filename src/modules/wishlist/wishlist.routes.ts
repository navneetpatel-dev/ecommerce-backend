// Wishlist module - User wishlist management
import { Router } from 'express';
import { authenticate } from '@middleware/auth.middleware';
import { validate } from '@middleware/validate.middleware';
import * as controller from './wishlist.controller';
import { AddToWishlistSchema } from './wishlist.dto';

const router = Router();

router.get('/', authenticate, controller.listWishlist);

router.post('/items', authenticate, validate(AddToWishlistSchema), controller.addToWishlist);

router.delete('/items/:productId', authenticate, controller.removeFromWishlist);

router.post('/items/:productId/move-to-cart', authenticate, controller.moveToCart);

export default router;

import { Router } from 'express';
import * as cartController from './cart.controller';
import { validate } from '@middleware/validate.middleware';
import { authenticate, optionalAuthenticate } from '@middleware/auth.middleware';
import { AddToCartSchema, UpdateCartItemSchema } from './cart.dto';

const router = Router();

router.post('/merge', authenticate, cartController.mergeGuestCart);

router.use(optionalAuthenticate);

router.get('/', cartController.getCart);
router.post('/items', validate(AddToCartSchema), cartController.addToCart);
router.patch('/items/:itemId', validate(UpdateCartItemSchema), cartController.updateCartItem);
router.delete('/items/:itemId', cartController.removeFromCart);
router.delete('/', cartController.clearCart);

export default router;

import { z } from 'zod';

/** Body for POST /wishlist/items. */
export const AddToWishlistSchema = z.object({
  productId: z.string().uuid(),
});

export type AddToWishlistRequest = z.infer<typeof AddToWishlistSchema>;

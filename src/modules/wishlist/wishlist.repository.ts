import { BaseRepository } from '@core/repository/BaseRepository';
import { Wishlist } from '@database/models/wishlist.model';

export class WishlistRepository extends BaseRepository<Wishlist> {
  constructor() {
    super(Wishlist);
  }

  async findByUserId(userId: string) {
    return this.model.findOne({
      where: { userId },
      include: ['items'],
    });
  }

  async findOrCreateByUserId(userId: string) {
    const [wishlist] = await this.model.findOrCreate({
      where: { userId },
      defaults: { userId },
    });
    return wishlist;
  }
}

export const wishlistRepository = new WishlistRepository();

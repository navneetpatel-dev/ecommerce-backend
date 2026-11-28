import { randomUUID } from 'node:crypto';
import { logger } from '@core/logger';
import { User } from '@database/models/user.model';
import { notificationsService } from '@modules/notifications/notifications.service';

/** Options of a vendor's published listing that a tax change has just put above its MRP. */
export type BlockedListing = { vendorId: string; productName: string; variants: number };

const MAX_NAMES = 10;

/** One email per vendor naming the listings that stopped selling. Never throws. */
export async function notifyAboveMrp(blocked: BlockedListing[]): Promise<void> {
  const byVendor = new Map<string, BlockedListing[]>();
  for (const listing of blocked) byVendor.set(listing.vendorId, [...(byVendor.get(listing.vendorId) ?? []), listing]);
  const run = randomUUID();
  for (const [vendorId, listings] of byVendor) {
    try {
      const names = listings.slice(0, MAX_NAMES).map((listing) => `${listing.productName} (${listing.variants})`).join('; ');
      const more = listings.length - MAX_NAMES;
      const users = await User.findAll({ where: { vendorId }, attributes: ['id'] });
      for (const user of users) {
        await notificationsService.enqueue({
          userId: user.id,
          type: 'PRODUCT_ABOVE_MRP',
          referenceType: 'Vendor',
          referenceId: `${run}:${user.id}`,
          templateData: {
            productName: listings.length > 1 ? `${listings.length} of your products` : listings[0]!.productName,
            productList: more > 0 ? `${names}; and ${more} more` : names,
          },
        });
      }
    } catch (error) {
      logger.error('Telling a vendor about over-MRP listings failed', {
        vendorId,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

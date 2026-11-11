import { isOwnStorageUrl } from '@core/s3/ownStorageUrl';
import { S3_ENTITY_TYPES, S3_PURPOSES } from '@core/s3/constants';

export const AVATAR_URL_NOT_OURS = 'Upload a photo from your device; links to other sites are not accepted';

/**
 * A profile photo must be a file this user uploaded through /api/uploads: an https
 * link on the store's own storage, under this user's avatar folder. Anything else
 * (another site, a tracking pixel, javascript:) is refused.
 */
export function isOwnAvatarUrl(url: string, userId: string): boolean {
  return isOwnStorageUrl(url, { entityType: S3_ENTITY_TYPES.USERS, purpose: S3_PURPOSES.AVATAR, entityId: userId });
}

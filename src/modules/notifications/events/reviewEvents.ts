import { env } from '@config/env';
import { logger } from '@core/logger';
import { Review } from '@database/models/review.model';
import { Product } from '@database/models/product.model';
import { Vendor } from '@database/models/vendor.model';
import { User } from '@database/models/user.model';
import { notificationsService } from '../notifications.service';
import { findVendorOwnerUserId } from '../orderNotifications';

const productUrl = (slug?: string | null, tail = '') =>
  `${env.CLIENT_URL.replace(/\/$/, '')}/products${slug ? `/${slug}${tail}` : ''}`;

type ReviewWithProduct = Review & { product?: Product | null };

async function loadReview(reviewId: string): Promise<ReviewWithProduct | null> {
  return (await Review.findByPk(reviewId, { include: [{ model: Product, as: 'product' }] })) as ReviewWithProduct | null;
}

/** The seller answered a shopper's review: tell the shopper, with the seller's actual words. */
export async function notifyReviewReplied(reviewId: string, response: string): Promise<void> {
  try {
    const review = await loadReview(reviewId);
    if (!review?.userId) return;
    const seller = review.product?.vendorId ? await Vendor.findByPk(review.product.vendorId, { attributes: ['businessName'] }) : null;
    await notificationsService.sendReviewReplied(review.userId, review.id, {
      reviewId: review.id,
      productId: review.productId,
      productName: review.product?.name,
      vendorName: seller?.businessName ?? 'The seller',
      response,
      productUrl: productUrl(review.product?.slug, '/reviews'),
    });
  } catch (error) {
    logger.warn('Review reply email failed', { reviewId, error: error instanceof Error ? error.message : error });
  }
}

/** A review was approved (immediately or after moderation) or rejected: tell the author. */
export async function notifyReviewDecision(reviewId: string, decision: 'published' | 'rejected', reason?: string): Promise<void> {
  try {
    const review = await loadReview(reviewId);
    if (!review?.userId) return;
    const data = {
      reviewId: review.id,
      productName: review.product?.name,
      rating: review.rating,
      reason: reason ?? '',
      productUrl: productUrl(review.product?.slug, '/reviews'),
    };
    await notificationsService.enqueue({
      userId: review.userId,
      type: decision === 'published' ? 'REVIEW_PUBLISHED' : 'REVIEW_REJECTED',
      referenceType: 'Review',
      referenceId: review.id,
      templateData: data,
    });
  } catch (error) {
    logger.warn('Review decision email failed', { reviewId, error: error instanceof Error ? error.message : error });
  }
}

/** A shopper reviewed a seller's product: tell the seller team. */
export async function notifyVendorNewReview(reviewId: string): Promise<void> {
  try {
    const review = await loadReview(reviewId);
    const vendorId = review?.product?.vendorId;
    if (!review || !vendorId) return;
    const author = await User.findByPk(review.userId, { attributes: ['name'] });
    const recipient = await findVendorOwnerUserId(vendorId);
    if (!recipient) return;
    await notificationsService.enqueue({
      userId: recipient,
      type: 'VENDOR_NEW_REVIEW',
      referenceType: 'Review',
      referenceId: review.id,
      templateData: {
        productName: review.product?.name,
        rating: review.rating,
        details: [
          { label: 'From', value: author?.name ?? 'A shopper' },
          ...(review.body ? [{ label: 'Review', value: `“${String(review.body).slice(0, 400)}”` }] : []),
        ],
      },
    });
  } catch (error) {
    logger.warn('Vendor review email failed', { reviewId, error: error instanceof Error ? error.message : error });
  }
}

/** A new review: live reviews are announced to the author and the seller; queued ones wait for moderation. */
export async function notifyReviewCreated(reviewId: string): Promise<void> {
  const review = await Review.findByPk(reviewId, { attributes: ['id', 'status'] });
  if (review?.status !== 'APPROVED') return;
  await notifyReviewApproved(reviewId);
}

/** A review went live (auto-approved or approved by a moderator). */
export async function notifyReviewApproved(reviewId: string): Promise<void> {
  await Promise.all([notifyReviewDecision(reviewId, 'published'), notifyVendorNewReview(reviewId)]);
}

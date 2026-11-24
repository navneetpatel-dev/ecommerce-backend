'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { sequelize } = require('../dist/database/models');

const SAMPLE_RETURN_PHOTOS = [
  'https://images.unsplash.com/photo-1526170375885-4d8ecf77b99f?w=800&fit=crop',
  'https://images.unsplash.com/photo-1546868871-7041f2a55e12?w=800&fit=crop',
  'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=800&fit=crop',
  'https://images.unsplash.com/photo-1583743814966-8936f5b7be1a?w=800&fit=crop',
  'https://images.unsplash.com/photo-1576566588028-4147f3842f27?w=800&fit=crop',
  'https://images.unsplash.com/photo-1556910103-1c02745aae4d?w=800&fit=crop',
];

const SAMPLE_DISPUTE_PHOTOS = [
  'https://images.unsplash.com/photo-1584438784894-089d6a62b8fa?w=800&fit=crop',
  'https://images.unsplash.com/photo-1625842268584-8f3296236761?w=800&fit=crop',
  'https://images.unsplash.com/photo-1587825140708-dfaf72ae4b04?w=800&fit=crop',
];

async function seedReturnPhotos() {
  console.log('Connecting to database...');
  await sequelize.authenticate();
  console.log('Database connected.');

  const returns = await sequelize.query(
    'SELECT id, "reasonCode", status FROM return_requests WHERE "deletedAt" IS NULL ORDER BY "createdAt" DESC',
    { type: sequelize.QueryTypes.SELECT }
  );

  console.log(`Found ${returns.length} return requests.`);

  const now = new Date();
  const threeDaysAgo = new Date(Date.now() - 3 * 86400000);

  let updatedCount = 0;
  for (let i = 0; i < returns.length; i++) {
    const ret = returns[i];
    const p1 = SAMPLE_RETURN_PHOTOS[i % SAMPLE_RETURN_PHOTOS.length];
    const p2 = SAMPLE_RETURN_PHOTOS[(i + 1) % SAMPLE_RETURN_PHOTOS.length];
    const p3 = SAMPLE_RETURN_PHOTOS[(i + 2) % SAMPLE_RETURN_PHOTOS.length];
    const photos = i % 3 === 0 ? [p1, p2, p3] : [p1, p2];

    let disputeStatus = null;
    let disputeReason = null;
    let disputeDescription = null;
    let disputeEvidence = [];
    let disputedAt = null;
    let disputeResolvedAt = null;
    let disputeResolutionNotes = null;

    if (i === 0) {
      // Return 0: Pending Dispute - Wrong item returned
      disputeStatus = 'PENDING';
      disputeReason = 'WRONG_ITEM_RETURNED';
      disputeDescription = 'Customer returned a completely different counterfeit item inside the box instead of the original product.';
      disputeEvidence = [SAMPLE_DISPUTE_PHOTOS[0], SAMPLE_DISPUTE_PHOTOS[1]];
      disputedAt = now;
    } else if (i === 2) {
      // Return 2: Pending Dispute - Damaged by buyer
      disputeStatus = 'PENDING';
      disputeReason = 'ITEM_DAMAGED_BY_BUYER';
      disputeDescription = 'Device returned with deep scratches, broken screen, and liquid ingress. Clearly damaged after delivery.';
      disputeEvidence = [SAMPLE_DISPUTE_PHOTOS[1], SAMPLE_DISPUTE_PHOTOS[2]];
      disputedAt = now;
    } else if (i === 5) {
      // Return 5: Upheld Dispute - Resolved by Admin
      disputeStatus = 'UPHELD';
      disputeReason = 'MISSING_PARTS';
      disputeDescription = 'Package returned without the primary power adapter, cables, and warranty card.';
      disputeEvidence = [SAMPLE_DISPUTE_PHOTOS[0], SAMPLE_DISPUTE_PHOTOS[2]];
      disputedAt = threeDaysAgo;
      disputeResolvedAt = now;
      disputeResolutionNotes = 'Seller photo evidence verified. Customer claim dismissed; return denied.';
    }

    await sequelize.query(
      `UPDATE return_requests 
       SET "photoUrls" = :photoUrls,
           "disputeStatus" = :disputeStatus,
           "disputeReason" = :disputeReason,
           "disputeDescription" = :disputeDescription,
           "disputeEvidenceUrls" = :disputeEvidence,
           "disputedAt" = :disputedAt,
           "disputeResolvedAt" = :disputeResolvedAt,
           "disputeResolutionNotes" = :disputeResolutionNotes,
           "receivedAt" = COALESCE("receivedAt", :now)
       WHERE id = :id`,
      {
        replacements: {
          id: ret.id,
          photoUrls: JSON.stringify(photos),
          disputeStatus,
          disputeReason,
          disputeDescription,
          disputeEvidence: JSON.stringify(disputeEvidence),
          disputedAt,
          disputeResolvedAt,
          disputeResolutionNotes,
          now,
        },
      }
    );
    updatedCount++;
  }

  console.log(`✓ Successfully updated ${updatedCount} return requests with photos, dispute statuses, and evidence.`);
  await sequelize.close();
}

seedReturnPhotos().catch((err) => {
  console.error('Error seeding return photos:', err);
  process.exit(1);
});

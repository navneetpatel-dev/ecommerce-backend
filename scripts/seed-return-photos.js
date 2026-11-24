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

  let updatedCount = 0;
  for (let i = 0; i < returns.length; i++) {
    const ret = returns[i];
    // Attach 1 to 3 customer return photos to almost all returns
    const p1 = SAMPLE_RETURN_PHOTOS[i % SAMPLE_RETURN_PHOTOS.length];
    const p2 = SAMPLE_RETURN_PHOTOS[(i + 1) % SAMPLE_RETURN_PHOTOS.length];
    const p3 = SAMPLE_RETURN_PHOTOS[(i + 2) % SAMPLE_RETURN_PHOTOS.length];
    const photos = i % 3 === 0 ? [p1, p2, p3] : [p1, p2];

    const isDisputed = i === 1 || i === 4;
    const disputeStatus = isDisputed ? 'PENDING' : null;
    const disputeReason = isDisputed ? 'WRONG_ITEM_RETURNED' : null;
    const disputeDescription = isDisputed
      ? 'The buyer returned an empty box / completely different product instead of the original item.'
      : null;
    const disputeEvidence = isDisputed
      ? [SAMPLE_DISPUTE_PHOTOS[i % SAMPLE_DISPUTE_PHOTOS.length], SAMPLE_DISPUTE_PHOTOS[(i + 1) % SAMPLE_DISPUTE_PHOTOS.length]]
      : [];

    await sequelize.query(
      `UPDATE return_requests 
       SET "photoUrls" = :photoUrls,
           "disputeStatus" = COALESCE("disputeStatus", :disputeStatus),
           "disputeReason" = COALESCE("disputeReason", :disputeReason),
           "disputeDescription" = COALESCE("disputeDescription", :disputeDescription),
           "disputeEvidenceUrls" = CASE WHEN :isDisputed THEN :disputeEvidence ELSE "disputeEvidenceUrls" END
       WHERE id = :id`,
      {
        replacements: {
          id: ret.id,
          photoUrls: JSON.stringify(photos),
          disputeStatus,
          disputeReason,
          disputeDescription,
          disputeEvidence: JSON.stringify(disputeEvidence),
          isDisputed,
        },
      }
    );
    updatedCount++;
  }

  console.log(`✓ Successfully updated ${updatedCount} return requests with photo and dispute evidence URLs.`);
  await sequelize.close();
}

seedReturnPhotos().catch((err) => {
  console.error('Error seeding return photos:', err);
  process.exit(1);
});

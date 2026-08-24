import { sequelize, Vendor, VendorDocument } from '../database/models';
import { v4 as uuidv4 } from 'uuid';

async function main() {
  await sequelize.authenticate();
  console.log('Database connected.');

  const vendors = await Vendor.findAll();
  console.log(`Found ${vendors.length} vendors.`);

  for (const vendor of vendors) {
    // Delete existing documents for this vendor
    await VendorDocument.destroy({ where: { vendorId: vendor.id }, force: true });

    const slug = vendor.slug || vendor.id;
    const now = new Date();

    const diverseDocuments = [
      {
        id: uuidv4(),
        vendorId: vendor.id,
        type: 'AADHAAR',
        url: `https://docs.example.com/kyc/${slug}/aadhaar_card.pdf`,
        verified: true,
        verifiedById: null,
        rejectionReason: null,
        rejectedAt: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: uuidv4(),
        vendorId: vendor.id,
        type: 'PAN',
        url: `https://docs.example.com/kyc/${slug}/pan_card.jpg`,
        verified: true,
        verifiedById: null,
        rejectionReason: null,
        rejectedAt: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: uuidv4(),
        vendorId: vendor.id,
        type: 'BANK_PROOF',
        url: `https://docs.example.com/kyc/${slug}/bank_statement.pdf`,
        verified: false,
        verifiedById: null,
        rejectionReason: null,
        rejectedAt: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: uuidv4(),
        vendorId: vendor.id,
        type: 'ADDRESS_PROOF',
        url: `https://docs.example.com/kyc/${slug}/utility_bill_address_proof.docx`,
        verified: false,
        verifiedById: null,
        rejectionReason: null,
        rejectedAt: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: uuidv4(),
        vendorId: vendor.id,
        type: 'GST_CERT',
        url: `https://docs.example.com/kyc/${slug}/gst_certificate.png`,
        verified: false,
        verifiedById: null,
        rejectionReason: 'Name on GST certificate does not match business registration name.',
        rejectedAt: new Date(),
        createdAt: now,
        updatedAt: now,
      },
      // Note: AUTHORIZED_SIGNATORY_ID is deliberately omitted so its status is NOT_UPLOADED!
    ];

    await VendorDocument.bulkCreate(diverseDocuments as any);
    console.log(`Updated diverse KYC documents for vendor: ${vendor.businessName} (${vendor.id})`);
  }

  console.log('✓ Diverse KYC data setup complete.');
  await sequelize.close();
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});

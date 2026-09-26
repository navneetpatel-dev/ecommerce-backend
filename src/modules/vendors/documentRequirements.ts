import { Op } from 'sequelize';
import { DocumentRequirement } from '@database/models/documentRequirement.model';
import { Category } from '@database/models/category.model';
import { VendorDocument } from '@database/models/vendorDocument.model';
import { VendorCategory } from '@database/models/vendorCategory.model';
import { Vendor } from '@database/models/vendor.model';
import {
  VENDOR_DOCUMENT_CHECKLIST_STATUS,
  VENDOR_DOCUMENT_TYPE,
  type VendorDocumentChecklistStatus,
  type VendorDocumentType,
  type VendorEntityType,
} from '@core/constants/statuses';

const UNIVERSAL_BASE_TYPES: VendorDocumentType[] = [
  VENDOR_DOCUMENT_TYPE.GST_CERT,
  VENDOR_DOCUMENT_TYPE.PAN,
  VENDOR_DOCUMENT_TYPE.AADHAAR,
  VENDOR_DOCUMENT_TYPE.BANK_PROOF,
  VENDOR_DOCUMENT_TYPE.ADDRESS_PROOF,
  VENDOR_DOCUMENT_TYPE.AUTHORIZED_SIGNATORY_ID,
];

/** Walk parentId chain so child categories inherit food/regulated requirements. */
export async function expandCategoryIdsWithAncestors(
  categoryIds: string[],
): Promise<string[]> {
  const ids = new Set(categoryIds.filter(Boolean));
  if (ids.size === 0) return [];

  let frontier = [...ids];
  while (frontier.length > 0) {
    const parents = await Category.findAll({
      where: { id: { [Op.in]: frontier } },
      attributes: ['id', 'parentId'],
    });
    frontier = [];
    for (const row of parents) {
      if (row.parentId && !ids.has(row.parentId)) {
        ids.add(row.parentId);
        frontier.push(row.parentId);
      }
    }
  }
  return [...ids];
}

/**
 * Single source of truth for required KYC document types for a vendor context.
 * Queries DocumentRequirement — not hardcoded if/else — so new regulated categories
 * only need seed/data changes.
 */
export async function resolveRequiredDocuments(
  entityType: VendorEntityType | null | undefined,
  selectedCategoryIds: string[] = [],
): Promise<VendorDocumentType[]> {
  const categoryIds = await expandCategoryIdsWithAncestors(selectedCategoryIds);

  const orClauses: Record<string, unknown>[] = [
    { entityType: null, categoryId: null },
  ];
  if (entityType) {
    orClauses.push({ entityType, categoryId: null });
  }
  if (categoryIds.length > 0) {
    orClauses.push({ categoryId: { [Op.in]: categoryIds } });
  }

  const rows = await DocumentRequirement.findAll({
    where: {
      isMandatory: true,
      [Op.or]: orClauses,
    },
    attributes: ['documentType'],
  });

  const types = new Set<VendorDocumentType>(rows.map((row) => row.documentType));

  // Safety: if seeder not run yet, still require the universal base set.
  if (types.size === 0) {
    for (const type of UNIVERSAL_BASE_TYPES) types.add(type);
  }

  return [...types].sort();
}

export type KycChecklistItem = {
  documentType: VendorDocumentType;
  status: VendorDocumentChecklistStatus;
  documentId: string | null;
  url: string | null;
  verified: boolean;
  rejectionReason: string | null;
  verifiedById: string | null;
};

export async function buildKycChecklist(
  vendorId: string,
  entityType: VendorEntityType | null | undefined,
  categoryIds?: string[],
): Promise<{
  requiredDocumentTypes: VendorDocumentType[];
  items: KycChecklistItem[];
  isComplete: boolean;
}> {
  let selectedCategoryIds = categoryIds;
  if (!selectedCategoryIds) {
    const links = await VendorCategory.findAll({
      where: { vendorId },
      attributes: ['categoryId'],
    });
    selectedCategoryIds = links.map((link) => link.categoryId);
  }

  const requiredDocumentTypes = await resolveRequiredDocuments(entityType, selectedCategoryIds);
  const documents = await VendorDocument.findAll({ where: { vendorId } });
  const byType = new Map(documents.map((doc) => [doc.type, doc]));

  const items: KycChecklistItem[] = requiredDocumentTypes.map((documentType) => {
    const doc = byType.get(documentType);
    if (!doc) {
      return {
        documentType,
        status: VENDOR_DOCUMENT_CHECKLIST_STATUS.NOT_UPLOADED,
        documentId: null,
        url: null,
        verified: false,
        rejectionReason: null,
        verifiedById: null,
      };
    }
    if (doc.verified) {
      return {
        documentType,
        status: VENDOR_DOCUMENT_CHECKLIST_STATUS.VERIFIED,
        documentId: doc.id,
        url: doc.url,
        verified: true,
        rejectionReason: null,
        verifiedById: doc.verifiedById,
      };
    }
    if (doc.rejectedAt) {
      return {
        documentType,
        status: VENDOR_DOCUMENT_CHECKLIST_STATUS.REJECTED,
        documentId: doc.id,
        url: doc.url,
        verified: false,
        rejectionReason: doc.rejectionReason,
        verifiedById: null,
      };
    }
    return {
      documentType,
      status: VENDOR_DOCUMENT_CHECKLIST_STATUS.PENDING_REVIEW,
      documentId: doc.id,
      url: doc.url,
      verified: false,
      rejectionReason: doc.rejectionReason,
      verifiedById: null,
    };
  });

  const isComplete = items.every((item) => item.status === VENDOR_DOCUMENT_CHECKLIST_STATUS.VERIFIED);
  return { requiredDocumentTypes, items, isComplete };
}

/** True when every required doc for these categories is verified (for product LIVE gate). */
export async function areCategoryDocumentsSatisfied(
  vendorId: string,
  entityType: VendorEntityType | null | undefined,
  categoryIds: string[],
): Promise<boolean> {
  const required = await resolveRequiredDocuments(entityType, categoryIds);
  if (required.length === 0) return true;

  const documents = await VendorDocument.findAll({
    where: { vendorId, type: { [Op.in]: required }, verified: true },
    attributes: ['type'],
  });
  const verified = new Set(documents.map((doc) => doc.type));
  return required.every((type) => verified.has(type));
}

/**
 * Recompute and store whether every KYC document the vendor needs is verified
 * (`vendors.kycVerified`). A vendor sells only while it is APPROVED and this holds, so
 * call it after anything that changes the answer: a document uploaded, replaced,
 * verified or rejected, or the vendor's categories or entity type changed. Returns the
 * new value.
 */
export async function refreshVendorKycStatus(vendorId: string): Promise<boolean> {
  const vendor = await Vendor.findByPk(vendorId, { attributes: ['id', 'entityType', 'kycVerified'] });
  if (!vendor) return false;
  const { isComplete } = await buildKycChecklist(vendorId, vendor.entityType);
  if (vendor.kycVerified !== isComplete) {
    await vendor.update({ kycVerified: isComplete });
  }
  return isComplete;
}

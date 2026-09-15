/** S3 entity segments — matches `{env}/{entity-type}/…` key layout. */
export const S3_ENTITY_TYPE_VALUES = [
  'products',
  'vendors',
  'categories',
  'users',
  'returns',
  'banners',
  'reports',
  'tickets',
  'bug-reports',
  'payouts',
  'shipments',
  'delivery-agent-documents',
  'export',
] as const;

export type S3EntityType = (typeof S3_ENTITY_TYPE_VALUES)[number];

export const S3_ENTITY_TYPES = {
  PRODUCTS: 'products',
  VENDORS: 'vendors',
  CATEGORIES: 'categories',
  USERS: 'users',
  RETURNS: 'returns',
  BANNERS: 'banners',
  REPORTS: 'reports',
  TICKETS: 'tickets',
  BUG_REPORTS: 'bug-reports',
  PAYOUTS: 'payouts',
  SHIPMENTS: 'shipments',
  DELIVERY_AGENT_DOCUMENTS: 'delivery-agent-documents',
  EXPORT: 'export',
} as const satisfies Record<string, S3EntityType>;

/** Purpose segments under an entity — matches `…/{entityId}/{purpose}/{uuid}.ext`. */
export const S3_PURPOSE_VALUES = [
  'images',
  'logo',
  'banner',
  'kyc',
  'image',
  'avatar',
  'photos',
  'export',
  'attachments',
  'video',
  'size-chart',
  'proof',
  'export-artifact',
] as const;

export type S3Purpose = (typeof S3_PURPOSE_VALUES)[number];

export const S3_PURPOSES = {
  IMAGES: 'images',
  LOGO: 'logo',
  BANNER: 'banner',
  KYC: 'kyc',
  IMAGE: 'image',
  AVATAR: 'avatar',
  PHOTOS: 'photos',
  EXPORT: 'export',
  ATTACHMENTS: 'attachments',
  VIDEO: 'video',
  SIZE_CHART: 'size-chart',
  PROOF: 'proof',
  EXPORT_ARTIFACT: 'export-artifact',
} as const satisfies Record<string, S3Purpose>;

/** Allowed purpose values per entity type. */
export const S3_ENTITY_PURPOSES: Record<S3EntityType, readonly S3Purpose[]> = {
  [S3_ENTITY_TYPES.PRODUCTS]: [S3_PURPOSES.IMAGES, S3_PURPOSES.VIDEO, S3_PURPOSES.SIZE_CHART],
  [S3_ENTITY_TYPES.VENDORS]: [S3_PURPOSES.LOGO, S3_PURPOSES.BANNER, S3_PURPOSES.KYC],
  [S3_ENTITY_TYPES.CATEGORIES]: [S3_PURPOSES.IMAGE],
  [S3_ENTITY_TYPES.USERS]: [S3_PURPOSES.AVATAR],
  [S3_ENTITY_TYPES.RETURNS]: [S3_PURPOSES.PHOTOS],
  [S3_ENTITY_TYPES.BANNERS]: [S3_PURPOSES.IMAGE],
  [S3_ENTITY_TYPES.REPORTS]: [S3_PURPOSES.EXPORT],
  [S3_ENTITY_TYPES.TICKETS]: [S3_PURPOSES.ATTACHMENTS],
  [S3_ENTITY_TYPES.BUG_REPORTS]: [S3_PURPOSES.ATTACHMENTS],
  [S3_ENTITY_TYPES.PAYOUTS]: [S3_PURPOSES.ATTACHMENTS],
  [S3_ENTITY_TYPES.SHIPMENTS]: [S3_PURPOSES.PROOF],
  [S3_ENTITY_TYPES.DELIVERY_AGENT_DOCUMENTS]: [S3_PURPOSES.KYC],
  [S3_ENTITY_TYPES.EXPORT]: [S3_PURPOSES.EXPORT_ARTIFACT],
};

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_VIDEO_UPLOAD_BYTES = 50 * 1024 * 1024;
export const MAX_BULK_UPLOAD_FILES = 20;
export const S3_ORPHAN_MAX_AGE_MS = 24 * 60 * 60 * 1000;

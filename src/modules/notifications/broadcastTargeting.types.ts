import type { RoleName } from '@core/constants/statuses';

export type UserActivityFilter =
  | 'ordered_last_30d'
  | 'inactive_30d'
  | 'inactive_90d'
  | 'repeat_buyers'
  | 'abandoned_cart';

export interface BroadcastTargetConfig {
  mode?: 'roles' | 'users' | 'user_segment' | 'vendor_segment';
  allUsers?: boolean;
  role?: RoleName;
  roles?: RoleName[];
  userIds?: string[];
  emails?: string[];
  userSegment?: {
    status?: 'ACTIVE' | 'BLOCKED' | 'ALL';
    emailVerified?: boolean;
    emailMarketingConsent?: boolean;
    signedUpWithinDays?: number;
    activity?: UserActivityFilter;
    state?: string;
    city?: string;
  };
  vendorSegment?: {
    vendorStatus?: 'APPROVED' | 'PENDING' | 'SUSPENDED';
    kycVerified?: boolean;
    categoryIds?: string[];
    state?: string;
    minPerformanceScore?: number;
    maxPerformanceScore?: number;
  };
  excludeUserIds?: string[];
  excludeRoles?: RoleName[];
}

export interface ResolvedRecipient {
  id: string;
  email: string;
  name: string;
  role: string;
  businessName: string | null;
  city: string | null;
  emailVerified: boolean;
  emailMarketingConsent: boolean;
  emailSuppressed: boolean;
  hasPush: boolean;
}

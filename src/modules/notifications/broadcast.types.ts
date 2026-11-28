import type {
  BroadcastChannel,
  BroadcastClassification,
  BroadcastPriority,
} from '@database/models/adminBroadcast.model';
import type { BroadcastTargetConfig } from './broadcastTargeting.types';

export interface BroadcastSendResult {
  broadcastId: string;
  status: string;
  scheduledAt?: Date | null;
  targeted: number;
  queued: number;
}

export interface BroadcastInput extends BroadcastTargetConfig {
  subject: string;
  message: string;
  ctaLabel?: string;
  ctaUrl?: string;
  classification?: BroadcastClassification;
  priority?: BroadcastPriority;
  channels?: BroadcastChannel[];
  scheduledAt?: string | null;
}

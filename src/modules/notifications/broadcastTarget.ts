import type { BroadcastTargetConfig } from './broadcastTargeting.types';

type Targeting = Pick<BroadcastTargetConfig, 'mode' | 'allUsers' | 'role' | 'roles' | 'userIds' | 'emails'>;

/**
 * Whether a targeting names anyone: everyone, a role, people, addresses or a segment.
 * One that names nobody reaches nobody; its empty filters must not match every account.
 */
export function hasBroadcastTarget(config: Targeting): boolean {
  return (
    Boolean(config.allUsers) ||
    Boolean(config.role) ||
    Boolean(config.roles?.length) ||
    Boolean(config.userIds?.length) ||
    Boolean(config.emails?.length) ||
    config.mode === 'user_segment' ||
    config.mode === 'vendor_segment'
  );
}

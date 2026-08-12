import { BUG_REPORT_STATUS, type BugReportStatus } from '@core/constants/statuses';

/** Canonical bug status transitions — imported by service + tests (single source of truth). */
export const BUG_ALLOWED_TRANSITIONS: Record<BugReportStatus, BugReportStatus[]> = {
  [BUG_REPORT_STATUS.NEW]: [BUG_REPORT_STATUS.TRIAGED, BUG_REPORT_STATUS.DUPLICATE],
  [BUG_REPORT_STATUS.TRIAGED]: [
    BUG_REPORT_STATUS.IN_PROGRESS,
    BUG_REPORT_STATUS.DUPLICATE,
    BUG_REPORT_STATUS.WONT_FIX,
  ],
  [BUG_REPORT_STATUS.IN_PROGRESS]: [
    BUG_REPORT_STATUS.FIXED,
    BUG_REPORT_STATUS.DUPLICATE,
  ],
  [BUG_REPORT_STATUS.FIXED]: [
    BUG_REPORT_STATUS.VERIFIED,
    BUG_REPORT_STATUS.IN_PROGRESS,
  ],
  [BUG_REPORT_STATUS.VERIFIED]: [BUG_REPORT_STATUS.CLOSED],
  [BUG_REPORT_STATUS.CLOSED]: [],
  [BUG_REPORT_STATUS.WONT_FIX]: [],
  [BUG_REPORT_STATUS.DUPLICATE]: [],
};

export function canTransitionBugStatus(from: BugReportStatus, to: BugReportStatus): boolean {
  return (BUG_ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}

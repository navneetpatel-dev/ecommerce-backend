export {
  TICKET_MAX_IMAGES,
  TICKET_MAX_VIDEOS,
  TICKET_MAX_VIDEO_SECONDS,
  BUG_MAX_SCREENSHOTS,
  BUG_MAX_RECORDINGS,
  BUG_MAX_RECORDING_SECONDS,
  MAX_VIDEO_BYTES,
  assertAttachmentLimits,
  assertCombinedAttachmentLimits,
  type TicketAttachmentInput,
  type BugAttachmentInput,
} from './limits';
export {
  parseMp4DurationSeconds,
  parseWebMDurationSeconds,
  assertRemoteVideoBackstop,
} from './probe';

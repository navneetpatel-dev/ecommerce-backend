import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

/**
 * Contract: expected indexes/constraints for tickets + bugs must remain in migrations.
 * Full EXPLAIN against a live DB is environment-specific; this guards against silent drops.
 */
const EXPECTED_SNIPPETS = [
  'support_tickets_customer_status_idx',
  'support_tickets_vendor_status_idx',
  'support_tickets_status_priority_created_idx',
  'support_tickets_active_status_created_idx',
  'ticket_messages_ticket_created_idx',
  'ticket_messages_ticket_created_id_idx',
  'support_tickets_related_order_fk',
  'ticket_messages_sender_role_chk',
  'ticket_messages_body_len_chk',
  'support_tickets_description_len_chk',
  'support_tickets_rating_range_chk',
  'bug_reports_active_status_severity_created_idx',
  'bug_reports_description_len_chk',
  'bug_reports_steps_len_chk',
  'bug_reports_reporter_status_idx',
  'bug_report_comments_bug_created_id_idx',
  'bug_reports_fixed_resolved_at_idx',
  'bug_reports_verified_verified_at_idx',
  'support_tickets_resolved_resolved_at_idx',
] as const;

describe('help/bug query index contract', () => {
  it('keeps required index and constraint names in migrations', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const migrationsDir = join(here, '../../../../database/migrations');
    const files = [
      '20240101000076-create-support-tickets.js',
      '20240101000077-create-bug-reports.js',
      '20240101000079-help-bug-gap-fixes.js',
      '20240101000083-help-bug-closure-fixes.js',
      '20240101000084-help-bug-ticket-closure.js',
      '20240101000085-help-bug-gap-closure.js',
      '20240101000086-help-bug-final-fixes.js',
    ];
    const blob = files
      .map((name) => readFileSync(join(migrationsDir, name), 'utf8'))
      .join('\n');

    for (const snippet of EXPECTED_SNIPPETS) {
      assert.ok(blob.includes(snippet), `missing migration snippet: ${snippet}`);
    }
  });
});

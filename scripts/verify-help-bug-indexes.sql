-- Verification queries for support-ticket / bug-report list indexes.
--
-- Run against a populated DB (ticket + bug seeders). Samples real customer/vendor/
-- reporter ids so plans are not empty.
--
-- Usage (from repo root; disable pager so output doesn't stop on ':'):
--   PAGER=cat psql "postgresql://postgres:postgres@localhost:5432/ecommerce_dev" \
--     -f ./backend/scripts/verify-help-bug-indexes.sql
--
-- Or: psql ... -P pager=off -f ...
--
-- What to look for: Index Scan / Index Only Scan / Bitmap Index Scan on the named
-- indexes below. Seq Scan on a tiny empty result is OK; Seq Scan on large filtered
-- tables is not.

\echo '=== Sample keys (must be non-null for meaningful EXPLAIN) ==='
SELECT
  (SELECT "customerId" FROM support_tickets WHERE "deletedAt" IS NULL LIMIT 1) AS sample_customer,
  (SELECT "relatedVendorId" FROM support_tickets WHERE "relatedVendorId" IS NOT NULL AND "deletedAt" IS NULL LIMIT 1) AS sample_vendor,
  (SELECT id FROM support_tickets WHERE "deletedAt" IS NULL ORDER BY "createdAt" DESC LIMIT 1) AS sample_ticket,
  (SELECT "reporterId" FROM bug_reports WHERE "deletedAt" IS NULL LIMIT 1) AS sample_reporter;

-- ============================================================================
-- Support tickets
-- ============================================================================

\echo '=== 1. listMine — expect support_tickets_customer_status_idx ==='
EXPLAIN (ANALYZE, BUFFERS)
SELECT *
FROM support_tickets
WHERE "customerId" = (
  SELECT "customerId" FROM support_tickets WHERE "deletedAt" IS NULL LIMIT 1
)
  AND "deletedAt" IS NULL
ORDER BY "createdAt" DESC, id DESC
LIMIT 21;

\echo '=== 2. listVendor — expect support_tickets_vendor_status_idx ==='
EXPLAIN (ANALYZE, BUFFERS)
SELECT *
FROM support_tickets
WHERE "relatedVendorId" = (
  SELECT "relatedVendorId"
  FROM support_tickets
  WHERE "relatedVendorId" IS NOT NULL AND "deletedAt" IS NULL
  LIMIT 1
)
  AND status = 'OPEN'
  AND "deletedAt" IS NULL
ORDER BY "createdAt" DESC, id DESC
LIMIT 21;

\echo '=== 3. listAdmin status+priority — expect support_tickets_status_priority_created_idx ==='
EXPLAIN (ANALYZE, BUFFERS)
SELECT *
FROM support_tickets
WHERE status = 'OPEN'
  AND priority = 'HIGH'
  AND "deletedAt" IS NULL
ORDER BY "createdAt" DESC, id DESC
LIMIT 21;

\echo '=== 4. active tickets — expect support_tickets_active_status_created_idx ==='
EXPLAIN (ANALYZE, BUFFERS)
SELECT *
FROM support_tickets
WHERE status NOT IN ('CLOSED', 'RESOLVED')
  AND "deletedAt" IS NULL
ORDER BY "createdAt" DESC
LIMIT 50;

\echo '=== 4b. ticket_reads by user ==='
EXPLAIN (ANALYZE, BUFFERS)
SELECT tr.*
FROM ticket_reads tr
WHERE tr."userId" = (
  SELECT "customerId" FROM support_tickets WHERE "deletedAt" IS NULL LIMIT 1
)
LIMIT 50;

\echo '=== 5. latest message preview DISTINCT ON — expect ticket_messages_ticket_created_idx ==='
EXPLAIN (ANALYZE, BUFFERS)
SELECT DISTINCT ON ("ticketId") "ticketId", body, "senderId", "senderRole"
FROM ticket_messages
WHERE "ticketId" IN (
  SELECT id FROM support_tickets WHERE "deletedAt" IS NULL LIMIT 20
)
  AND "deletedAt" IS NULL
ORDER BY "ticketId", "createdAt" DESC, id DESC;

\echo '=== 6. listMessages thread — expect ticket_messages_ticket_created_idx ==='
EXPLAIN (ANALYZE, BUFFERS)
SELECT *
FROM ticket_messages
WHERE "ticketId" = (
  SELECT id FROM support_tickets WHERE "deletedAt" IS NULL ORDER BY "createdAt" DESC LIMIT 1
)
  AND "deletedAt" IS NULL
ORDER BY "createdAt" DESC, id DESC
LIMIT 21;

-- ============================================================================
-- Bug reports
-- ============================================================================

\echo '=== 7. listMine bugs — expect bug_reports_reporter_status_idx ==='
EXPLAIN (ANALYZE, BUFFERS)
SELECT *
FROM bug_reports
WHERE "reporterId" = (
  SELECT "reporterId" FROM bug_reports WHERE "deletedAt" IS NULL LIMIT 1
)
  AND "deletedAt" IS NULL
ORDER BY "createdAt" DESC, id DESC
LIMIT 21;

\echo '=== 8. listAdmin status+severity — expect bug_reports_status_severity_created_idx ==='
EXPLAIN (ANALYZE, BUFFERS)
SELECT *
FROM bug_reports
WHERE status = 'TRIAGED'
  AND severity = 'HIGH'
  AND "deletedAt" IS NULL
ORDER BY "createdAt" DESC, id DESC
LIMIT 21;

\echo '=== 9. active bugs — expect bug_reports_active_status_severity_created_idx ==='
EXPLAIN (ANALYZE, BUFFERS)
SELECT *
FROM bug_reports
WHERE status NOT IN ('CLOSED', 'WONT_FIX')
  AND "deletedAt" IS NULL
ORDER BY "createdAt" DESC
LIMIT 50;

\echo '=== 10. markVerifiedIfDue — expect bug_reports_fixed_resolved_at_idx ==='
EXPLAIN (ANALYZE, BUFFERS)
SELECT *
FROM bug_reports
WHERE status = 'FIXED'
  AND "resolvedAt" <= now() - interval '7 days'
LIMIT 100;

\echo '=== 10b. markClosedIfDue — expect bug_reports_verified_verified_at_idx ==='
EXPLAIN (ANALYZE, BUFFERS)
SELECT *
FROM bug_reports
WHERE status = 'VERIFIED'
  AND "verifiedAt" <= now() - interval '7 days'
LIMIT 100;

\echo '=== 11. closeExpiredResolved — expect support_tickets_resolved_resolved_at_idx ==='
EXPLAIN (ANALYZE, BUFFERS)
SELECT *
FROM support_tickets
WHERE status = 'RESOLVED'
  AND "resolvedAt" <= now() - interval '7 days'
LIMIT 100;

\echo '=== Done ==='

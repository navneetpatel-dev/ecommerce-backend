# Report export runbook

Operational guide for async report exports (xlsx/csv/pdf).

## Architecture

- **Enqueue**: Export endpoints return `{ async: true, exportId, status: PENDING, rowCountKnown: false }` in ~200ms. Row count is **not** computed at enqueue.
- **Worker**: BullMQ `report-export` queue runs `ReportEngine.processExportJob`, streams rows via `createReportRowIterator`, uploads to S3 (or local `storage/report-exports`), marks log `READY`.
- **Dedup**: `exportKey` (SHA-256 of user + report + filters + format). READY logs within `REPORT_EXPORT_CACHE_TTL_MIN` (default **10_080** = 7 days) with a valid artifact are reused (`cached: true`, metric `cache_hit`).
- **Artifact probe**: Redis cache (`report-export:artifact:{id}`, 5 min TTL) backs S3/local existence checks during dedup.
- **Scheduled reports**: Weekly cron job runs on the **`report-export`** queue (`SCHEDULED_REPORTS_JOB`), not `s3-orphan-cleanup`.

## Status polling

- `GET /api/reports/exports/:id` — auth required before cache read.
- Send `If-None-Match: <etag>` while `PENDING`/`PROCESSING` for **304** when unchanged.
- `rowCountKnown: false` until status is `READY` (or worker wrote a non-zero count on reclaim).
- When S3 is configured, `fileUrl` is omitted from status JSON; clients use `downloadUrl` (presigned) or `/download`.

## User retry

- `POST /api/reports/exports/:id/retry` — re-enqueues a **FAILED** export owned by the caller.

## Admin ops

- `GET /api/reports/admin/exports?status=&reportType=` — recent logs + `{ queue: { waiting, active, failed } }`.
- `POST /api/reports/admin/exports/:id/retry` — re-enqueues as the **original export user** (`asOriginalUser: true`).

## Failure modes

| Symptom | Likely cause | Action |
|--------|--------------|--------|
| 429 too many pending | User has ≥ `REPORT_EXPORT_MAX_PENDING_PER_USER` inflight | Wait; check stuck PROCESSING |
| 503 queue unavailable | Redis/BullMQ down in prod | Restore queue; exports fail-closed |
| READY but download 404 | S3 object deleted | Stale dedup marks FAILED on next request; user re-exports |
| PROCESSING stuck | Worker crash | Reclaimed after `REPORT_EXPORT_STALE_PROCESSING_MIN`; or manual FAILED + retry |
| PENDING stuck | `queue.add` failed or worker never picked up | Auto-FAILED after `REPORT_EXPORT_PENDING_STALE_MIN` (default 15 min) |
| FAILED artifact missing | Prior stale READY | Automatic on dedup probe; ops retry |

## Metrics (structured logs)

- `report_export_enqueued`, `report_export_cache_hit`, `report_export_completed`, `report_export_failed`
- `report_export_queue_depth` — waiting/active/failed gauges

## Cron jobs

- **Weekly reports**: Monday 06:00 UTC — `scheduled-weekly-reports` on **`report-export`** queue.
- **Export cleanup**: Daily 03:15 — expires old READY artifacts; fails stale PENDING; deletes old FAILED logs.
- **S3 orphan cleanup**: Daily 03:00.

## Migrations

Apply before deploy:

```bash
cd backend && npm run db:migrate
```

- `20240101000102-report-export-optimization.js` — export log columns, indexes
- `20240101000103-report-export-inflight-unique.js` — partial unique on inflight `exportKey`

## Local dev

- Set `REPORT_EXPORT_INLINE_DEV=true` to process exports in-process when queue is unavailable (non-production only).
- Artifacts land under `backend/storage/report-exports/` when S3 is not configured.

## Key env vars

| Variable | Default | Purpose |
|----------|---------|---------|
| `REPORT_EXPORT_CACHE_TTL_MIN` | 10080 (7d) | Dedup window; align with artifact TTL |
| `REPORT_EXPORT_ARTIFACT_TTL_DAYS` | 7 | S3/local artifact retention |
| `REPORT_EXPORT_PENDING_STALE_MIN` | 15 | PENDING → FAILED in engine filter + cleanup |
| `REPORT_EXPORT_FAILED_RETENTION_DAYS` | 30 | Delete old FAILED log rows |
| `REPORT_EXPORT_STALE_PROCESSING_MIN` | 60 | Reclaim stuck PROCESSING |
| `REPORT_EXPORT_MAX_PENDING_PER_USER` | 3 | Inflight cap per user |

See `backend/src/modules/reports/reportExportConfig.ts` for chunk size, presigned URL expiry, worker concurrency, and rate limits.

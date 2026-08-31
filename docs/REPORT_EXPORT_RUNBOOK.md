# Report export runbook

Operational guide for async report exports (xlsx/csv/pdf).

## Architecture

- **Enqueue**: `POST/GET` export endpoints return `{ async: true, exportId, status: PENDING, rowCountKnown: false }` in ~200ms. Row count is **not** computed at enqueue.
- **Worker**: BullMQ `report-export` queue runs `ReportEngine.processExportJob`, streams rows via `createReportRowIterator`, uploads to S3 (or local `storage/report-exports`), marks log `READY`.
- **Dedup**: `exportKey` (SHA-256 of user + report + filters + format). READY logs within `REPORT_EXPORT_CACHE_TTL_MIN` with a valid artifact are reused (`cached: true`, metric `cache_hit`).
- **Artifact probe**: Redis cache (`report-export:artifact:{id}`, 5 min TTL) backs S3/local existence checks during dedup.

## Status polling

- `GET /api/reports/exports/:id` — auth required before cache read.
- Send `If-None-Match: <etag>` while `PENDING`/`PROCESSING` for **304** when unchanged.
- `rowCountKnown: false` until status is `READY` (or worker wrote a non-zero count on reclaim).

## Admin ops

- `GET /api/reports/admin/exports?status=&reportType=` — recent logs + `{ queue: { waiting, active, failed } }`.
- `POST /api/reports/admin/exports/:id/retry` — re-enqueues a **FAILED** export (new log row; dedup may still apply).

## Failure modes

| Symptom | Likely cause | Action |
|--------|--------------|--------|
| 429 too many pending | User has ≥ `REPORT_EXPORT_MAX_PENDING_PER_USER` inflight | Wait; check stuck PROCESSING |
| 503 queue unavailable | Redis/BullMQ down in prod | Restore queue; exports fail-closed |
| READY but download 404 | S3 object deleted | Stale dedup marks FAILED on next request; user re-exports |
| PROCESSING stuck | Worker crash | Reclaimed after `REPORT_EXPORT_STALE_PROCESSING_MIN`; or manual FAILED + retry |
| FAILED artifact missing | Prior stale READY | Automatic on dedup probe; ops retry |

## Metrics (structured logs)

- `report_export_enqueued`, `report_export_cache_hit`, `report_export_completed`, `report_export_failed`
- `report_export_queue_depth` — waiting/active/failed gauges

## Cron jobs

- **Weekly reports**: Monday 06:00 UTC — `scheduled-weekly-reports` on `s3-orphan-cleanup` queue.
- **Export cleanup**: Daily 03:15 — expires old artifacts and logs.
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

See `backend/src/modules/reports/reportExportConfig.ts` — cache TTL, artifact TTL, chunk size, presigned URL expiry, pending cap, stale processing window.

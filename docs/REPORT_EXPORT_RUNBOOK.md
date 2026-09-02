# Report export runbook

User-initiated report exports are **synchronous direct downloads**: one HTTP GET returns the file (`Content-Disposition: attachment`). No export IDs, polling, or queue for user exports.

## Architecture

```text
Browser  --GET ?format=pdf-->  API (reportEngine.runExportDirect)
                                    |
                                    +--> stream rows -> temp file -> buffer -> response
```

- **Generation**: `generateReportExport()` — permission check, row iterator, streaming writer, max-row cap.
- **Rate limit**: Redis per-user/min (`REPORT_EXPORT_RATE_LIMIT_PER_MIN`).
- **Scheduled weekly admin emails**: BullMQ `report-export` queue runs `scheduled-weekly-reports` only; worker generates xlsx in-process and emails as attachment.

## Dev setup

```bash
# Terminal 1 — API (handles all user exports)
cd backend && npm run dev

# Terminal 2 — Frontend
cd web && npm run dev

# Terminal 3 — Worker (optional in dev; scheduled emails + other background jobs)
cd backend && npm run worker:dev
```

User exports do **not** require a separate export worker.

## Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `REPORT_MAX_RANGE_DAYS` | 366 | Max date window for reports |
| `REPORT_EXPORT_MAX_ROWS` | 500000 | Hard row cap (422 if exceeded) |
| `REPORT_EXPORT_RATE_LIMIT_PER_MIN` | 5 | Per-user export rate limit |
| `REPORT_EXPORT_CHUNK_SIZE` | 2000 | Row batch size during streaming |
| `REPORT_EXPORT_WORKER_CONCURRENCY` | 1 | Scheduled report worker concurrency |

## Troubleshooting

| Symptom | Likely cause | Action |
|---------|--------------|--------|
| 429 rate limited | Too many exports/min | Wait 60s |
| 422 row limit | Date range too wide | Narrow range |
| Download timeout (120s FE) | Slow PDF / large export | Narrow range; check API logs |

## Scheduled reports

- **Cron**: Monday 06:00 UTC — `scheduled-weekly-reports` on `report-export` queue.
- **Reports**: `reconciliation`, `gmv-sales` (xlsx, last 7 days).
- **Delivery**: Email attachment to super-admin users (no export-ready notification link).

## Metrics

Structured logs via `emitReportExportMetric`: `report_export_completed`, `report_export_failed` with `reportType`, `format`, `rowCount`, `durationMs`, `byteSize`.

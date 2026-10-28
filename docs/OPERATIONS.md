# Operations: logging, correlation, rate limits, diagnostics

Status: v1 (issue #20).

## Structured logs

- One JSON object per line (`createJsonLogger`, `src/adapters/logging/json-logger.ts`): `ts`, `level`, `event` plus fields. `ts`, `level` and `event` cannot be overridden by fields.
- **Redaction by field name** (a second line of defence; callers still log ids, counts and codes only): any field whose name contains `password`, `secret`, `token`, `authorization`, `cookie`, `api key`, `text`, `transcript`, `audio`, `body`, `email`, `note` or `content` is written as `[redacted]`. String values are cut at 300 characters; non-primitive values are dropped.
- Never logged: request bodies, query strings, exception messages (they can contain content), transcript or note text, audio, attendee emails, secrets. Errors log `errorName` and a redacted `errorCode` only. Capability tokens in `/api/files/:token` paths are replaced in the logged route.

## Correlation ids

- Every request gets an id (`X-Request-Id`, also on the response). A well-formed inbound id (`[A-Za-z0-9_-]{8,64}`) is kept so a trace can continue across services; anything else is replaced.
- Routes get `Astro.locals.requestId` and `Astro.locals.log` (a logger that adds `requestId` to every line); pass `log` into use cases that log.
- Background jobs log with `jobId`, `jobKind`, `ownerId`, `meetingId` and `attempt` on every line (`runDueJobs`).
- Each request writes one `request.completed` line (`method`, `route`, `status`, `durationMs`, `ownerId`); 401/403/429 are warnings and 5xx are errors. An unexpected exception becomes `request.failed` and a 500 page that quotes only the request id, so a user can report it and an operator can find the line.

## Rate limits

| Endpoint | Limit | Counted per |
|---|---|---|
| `POST /sign-in` | 5 per email, 20 per client address, 15 min | email and client address (use case) |
| `POST /api/meetings/:id/chunks` | 120 per minute | owner (use case) |
| `POST /meetings/import` | 20 per 10 min | owner |
| `GET /meetings/:id/export.md` | 30 per 10 min | owner |
| `POST /meetings/:id/delete` | 10 per 10 min | owner |
| `POST /meetings/:id/note/regenerate` | 30 per 10 min | owner |
| `GET /search` | 60 per minute | owner |
| `POST /webhooks/*` | 300 per minute | client address (no session) |

Over the limit: `429` with `Retry-After` (JSON for `/api/*` and webhooks, a short page otherwise). The table lives in `src/app/ops/rate-limits.ts` and is matched on exact method and path in the middleware, so a new endpoint in this list is covered as soon as its route exists. The limiter is in-memory (per process); on Cloudflare back the `RateLimiter` port with Durable Objects or the Rate Limiting binding.

## Health and diagnostics

- `GET /healthz`: liveness, `{"status":"ok"}`, no data.
- `GET /diagnostics` (signed-in owners only): latest applied migration, the **owner's own** job counts by status (`pending`, `running`, `retrying`, `succeeded`, `failed`) and the provider modes (`speechToText`, `summaries`, `calendar`, `storage`; `fake` is reported honestly and a broken configuration shows `misconfigured`). Counts and mode names only: no content, hosts, secrets, error text or other owners' data.

## When something fails

- A failed job keeps its state (`failed`, attempts, redacted `last_error_code`) and is visible in the status endpoint and diagnostics; the logs carry `job.retry_scheduled` / `job.failed` with the job id.
- Deletion jobs that exhausted their attempts are re-queued hourly by the retention sweeper (#13), so a hidden meeting is always eventually erased.

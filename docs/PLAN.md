# Willycrumbs technical plan

Status: v1 (issue #2). Source of truth for product behavior is `product.md`; for process, `CLAUDE.md`. Table-level detail (columns, constraints, indexes) belongs to `docs/DATA_MODEL.md` (#4); this plan fixes names, boundaries and contracts so both dev lanes build against the same shapes. Change shared contracts here by small PR first, then dependants rebase.

## 1. Scope and resolved contradictions

Audience: one **founder** capturing their **own, consented** meetings. Non-goals (reject any work toward them): secret recording, joining calls as a bot, sales intelligence, inferring employee performance, extra roles, extra surfaces.

| Contradiction / ambiguity | Decision |
|---|---|
| `product.md` says Node.js + Astro, but prefers Cloudflare D1/R2/Workers/Queues. | Astro SSR is the single web surface. Production target is Cloudflare (`@astrojs/cloudflare`, D1, R2, Queues, cron triggers). Local dev and CI run the same code on Node with SQLite, filesystem object store and an in-process job runner, selected in one place (`src/composition.ts`). See section 9. |
| Spec lists "Search and settings" as one screen; issues #14-#19 split them. | Four screens as in the spec; the Settings page hosts template editor, folders, provider status, retention, export entry and deletion. Search results live at `/search` and are reachable from every page header. |
| Issue #2 mentions `src/server/*`; `CLAUDE.md` section 2 uses `src/app/*`. | `CLAUDE.md` wins: use cases live in `src/app/<context>/`. There is no `src/server/`. |
| `CLAUDE.md` section 4 lists lifecycle `scheduled -> capturing <-> paused -> captured -> transcribing -> ready`; issue #6 proposes `processing -> review -> published`. | Meeting status machine below (section 5) uses the #6 names because #6 implements it; `processing` covers transcribing and summarizing, `review` = draft ready for a person. `DATA_MODEL.md` (#4) may refine but must keep the transition table in section 5 intact or amend this plan first. |
| Calendar "import" vs "inbound webhook" in #7. | Import is owner-initiated (button or ICS paste/upload). Webhook is optional push for already-connected Google calendars; both converge on the same idempotent `importEvent` use case keyed by provider event id. |
| "Never claim consent from others" vs "confirm every participant has consented" (journey 1). | The owner ticks one statement: "I have told every participant this meeting will be recorded and transcribed, and I have their consent." The system stores who confirmed and when; it never records others' consent and never auto-ticks. |
| Multi-user vs "only the roles required". | Single role, **Owner**. Several Owner accounts exist only for tenant isolation (seeded A and B). No sharing, no teams. |

## 2. Bounded contexts and module layout

```
src/domain/<context>/   pure TS (no I/O, no Astro, no Date.now/Math.random; Clock/IdGenerator injected)
src/app/<context>/      use cases; receive ports as arguments
src/ports/              MeetingRepository, NoteRepository, TranscriptRepository, FolderRepository,
                        TemplateRepository, JobQueue, ObjectStore, Transcriber, Summarizer,
                        CalendarSource, Clock, IdGenerator, Logger, RateLimiter
src/adapters/{d1,sqlite,r2,fs,stt,llm,calendar,queue}/   real impl + deterministic fake each
src/pages/  src/components/  src/layouts/   Astro routes + UI (parse -> use case -> render)
src/composition.ts      the only place adapters are wired (per request / Worker env)
migrations/  seeds/  tests/{unit,integration,e2e}/  docs/
```

| Context | Owns | Key domain functions |
|---|---|---|
| identity | Owner, Session, CSRF, authz predicates (`src/domain/authz`) | `canViewMeeting`, `canExport`, `canDelete`, session expiry rules |
| meetings | Meeting, Attendee, Consent, Capture lifecycle | `startCapture(meeting, consent, now)`, `pause`, `resume`, `stopCapture`, `transition` |
| transcription | Chunk, TranscriptSegment, transcription Job | idempotent chunk key, backoff math, speaker relabel/merge |
| notes | Note, SummarySection (+source ranges), Decision, ActionItem, Template, Folder | `publishNote(note, folder)`, `verifySummary(summary, attendees, segments)`, template normalization |
| search | FTS index, Markdown export | snippet highlighting (escaped), `renderMarkdown(note)` |
| platform | ids, Clock, Result, errors, ProviderError, logging, rate-limit policy | |

Rules: `domain/` imports nothing from `app/`, `adapters/`, `pages/`, `astro`, `@cloudflare/*` (lint-enforced). Contexts reference each other by id and talk through use cases. Ports are named for the domain need; vendor types never leave `adapters/`.

## 3. Routes, pages and endpoints

All state-changing requests are `POST` with CSRF token (double-submit cookie plus `Origin` check); no mutation on `GET`. All owner-scoped routes resolve the Owner from the session cookie first; foreign or unknown ids return **404** (never 403) to avoid enumeration. Unauthenticated: redirect to `/sign-in?next=` for pages, 401 JSON for endpoints.

### 3.1 Pages (server-rendered Astro, plain forms, JS only where noted)

| Route | Screen | Primary action | Notes |
|---|---|---|---|
| `GET /` | Screen 1: Upcoming and recent meetings (#14) | **New note** | Calendar context, consent readiness, note status, folder filter, search box, import form. Meeting cards show status as text + icon. |
| `GET /meetings/new`, `POST /meetings` | New note form (title, start, IANA tz, agenda, attendees, template) | Create | Validation echoed inline. |
| `GET /meetings/:id` | Screen 2: Live note (#15) when status is `scheduled/capturing/paused/failed`; redirects to review when `processing/review/published` | **Start capture** (after consent) | Rough notes form; JS: MediaRecorder, level meter, timer, chunk upload with retry, `aria-live` status. |
| `GET /meetings/:id/review` | Screen 3: Review (#16) | **Publish to folder** | Transcript beside editable sections; speakers, decisions, action items; regenerate-selection; failed/pending states with retry. |
| `GET /search?q=&folder=` | Search results (#18) | Open result | Snippets with escaped highlights; owner-scoped FTS. |
| `GET /meetings/:id/review#seg-<n>` | Source context | | Opened from a search hit or section source link; highlights the cited segment range. |
| `GET /settings` | Screen 4: Settings (#19, #17) | | Sections: provider status, retention, folders, templates, export, permanent deletion. |
| `GET /settings/templates`, `GET /settings/templates/:id` | Template editor (#17) | Save | |
| `GET /settings/folders` | Folder management (#17) | Create | |
| `GET /sign-in`, `GET /signed-out`, `GET /session-expired`, `GET /forbidden-or-not-found` (rendered as the 404 body) | Auth states (#5) | | Understandable signed-out / expired / not-found pages. |
| `GET /healthz` | Liveness, status only (`{"status":"ok"}`), no data (#20) | | |
| `GET /diagnostics` | Authenticated diagnostics: migration version, job counts, provider status (#20) | | No transcript or audio content. |

### 3.2 Form actions and endpoints (all `POST` unless stated)

| Endpoint | Purpose | Idempotency / guards |
|---|---|---|
| `POST /sign-in`, `POST /sign-out` | Session create/destroy (rotate id on login) | Rate-limited; CSRF on sign-out |
| `POST /meetings` | Create meeting | Idempotency key from the form (hidden token) |
| `POST /meetings/:id` (update) | Edit title, agenda, attendees, rough notes (autosave form) | Last-write-wins with `updated_at` check; rough notes saved in any state except `deleting/deleted` |
| `POST /meetings/import` | Import a calendar event (provider fetch or ICS text/file) | Unique on (owner, provider, provider_event_id): same event twice = one Meeting. Rate-limited |
| `POST /meetings/:id/consent` | Owner confirms consent statement | Sets `consent_confirmed_at`, `consent_statement_version`; append-only; repeat is a no-op |
| `POST /meetings/:id/capture/start`, `/pause`, `/resume`, `/stop` | Capture lifecycle | Server rejects start without stored consent; `stop` enqueues exactly one transcription job (unique job key `(meeting_id, 'transcribe')`) |
| `POST /api/meetings/:id/chunks` (`PUT`-like body, raw audio) | Chunk upload | Owner + status `capturing/paused`, max bytes per chunk, max chunks/duration, audio content-type allowlist, `Idempotency-Key`/sequence number unique per meeting, rate-limited. Reject, never truncate |
| `GET /api/meetings/:id/status` | Poll capture/processing status for live updates | Owner-scoped, returns state + job states only (SSE is not planned; polling is enough) |
| `POST /meetings/:id/transcription/retry` | Retry failed transcription | Re-enqueues only failed chunks; no duplicate segments |
| `POST /meetings/:id/speakers` | Rename/merge speaker labels | Applied to segments in one transaction |
| `POST /meetings/:id/note` | Save edits to summary sections, decisions | Edits mark sections `edited` so regeneration preserves them |
| `POST /meetings/:id/action-items`, `/action-items/:itemId` | Create/edit/delete action item | Owner must be an Attendee or null; due date stored as UTC instant + display tz |
| `POST /meetings/:id/note/regenerate` | Regenerate-selection (one section) | Creates a summary job keyed by (note, section, revision) |
| `POST /meetings/:id/publish` | Publish note to a private folder | Confirmation field; repeat publish of same note/folder is a no-op; requires folder owned by Owner |
| `POST /folders`, `/folders/:id/rename`, `/folders/:id/delete` | Folder CRUD | Delete of a non-empty folder is **blocked** with a message (default; see open questions) |
| `POST /templates`, `/templates/:id`, `/templates/:id/delete` | Template CRUD | Validated lengths and counts |
| `POST /settings/retention` | Retention controls | Validated enum |
| `GET /meetings/:id/export.md` | Markdown export | `GET` is safe (read-only); owner-scoped; sanitized filename; `Content-Disposition: attachment`; `X-Content-Type-Options: nosniff`; rate-limited |
| `POST /meetings/:id/delete` | Permanent deletion | Typed confirmation; marks `deleting` and enqueues one deletion job; repeat is a no-op |
| `POST /webhooks/calendar` | Inbound provider webhook | Signature verified (constant time, timestamp tolerance); dedupe by provider event id in `ProviderEvent`; no session, no CSRF (signature instead); rate-limited |
| `GET /oauth/calendar/start`, `GET /oauth/calendar/callback` | Google OAuth connect | `state` bound to session, redirect URI checked against allowlist, tokens encrypted at rest. `start` mutates nothing durable beyond the state nonce |
| `GET /api/files/:token` | Short-lived authorized file URL (audio while it exists) | Token minted only after owner check, TTL <= 5 min; 404 after deletion |
| `POST /internal/jobs/run` (dev/Node only) | In-process job runner trigger | Disabled in production builds; not exposed on Workers |

## 4. Data tables (summary; detail in `docs/DATA_MODEL.md`, #4)

Every table that holds user data carries `owner_id` (directly, not only through a parent) so every query can include `owner_id = ?` taken from the session.

| Table | Purpose | Ownership | Key notes |
|---|---|---|---|
| `owner` | Account (domain word Owner; `User` in DB per #4 only for the auth table) | self | email unique, created_at |
| `session` | Server-side sessions | owner_id | hashed token, expires_at (idle + absolute), rotated on login |
| `meeting` | Aggregate root | owner_id | status, title, scheduled_start/end (UTC), timezone (IANA), agenda, rough_notes, consent_confirmed_at, consent_statement_version, calendar_provider + provider_event_id, template_id, folder_id, deleted_at |
| `attendee` | Person on a meeting | owner_id, meeting_id | name, email (optional, minimum data), unique (meeting, email) where present |
| `audio_chunk` | Uploaded chunk metadata | owner_id, meeting_id | seq, byte size, object key, state (`uploaded/transcribed/purged`), unique (meeting, seq) |
| `transcript_segment` | Transcript text | owner_id, meeting_id | chunk_id, start_ms, end_ms, speaker label, encrypted text + key id, unique (chunk_id, segment index) |
| `note` | Draft/published summary | owner_id, meeting_id | status `draft|published`, published_at, folder_id, revision |
| `note_section` | Summary section | owner_id, note_id | position, heading, body, source segment range(s), `edited` flag |
| `decision` | Decision with source range | owner_id, note_id | text, source range |
| `action_item` | Follow-up | owner_id, note_id | text, assignee attendee_id (nullable), due_at UTC + due_tz, status |
| `folder` | Private folder (publish target) | owner_id | name unique per owner |
| `template` | Meeting-type template | owner_id | name, sections (heading + prompt), is_default |
| `job` | Background job state | owner_id | kind (`transcribe|summarize|delete|retention`), unique key, status, attempts, next_run_at, last_error (redacted code, no content) |
| `audit_event` | Append-only history (consent, transitions, deletion record) | owner_id | no UPDATE/DELETE path; deletion leaves a content-free record |
| `provider_event` | Webhook dedupe | owner_id (nullable until resolved) | unique (provider, event_id) |
| `idempotency_key` | Submission dedupe | owner_id | unique (owner, key), response ref |
| `search_index` (FTS) | Derived index of notes and transcripts | owner_id column in the index | Rebuildable; deleted with the meeting |
| `provider_token` | Encrypted OAuth tokens | owner_id | ciphertext + key id |
| `settings` | Retention and preference | owner_id | raw audio retention (default: delete after transcription) |

Times: UTC instants (ISO-8601 text) plus the IANA tz name next to any local schedule or due date. Invariants (consent before capture, unique job per meeting, unique segment per chunk) are backed by DB constraints and transactions, not UI.

## 5. State transitions

### 5.1 Meeting status

```
scheduled -> capturing            (owner, requires stored consent)
capturing <-> paused              (owner)
capturing|paused -> processing    (owner stop; enqueues exactly one transcribe job)
processing -> review              (system: transcription + draft summary done)
processing -> failed              (system: retries exhausted; recoverable)
failed -> processing              (owner retry; resumes failed chunks only)
review -> published               (owner publish to folder)
published -> review               (owner reopen for edit; note returns to draft until republished)
scheduled|review|published|failed -> archived   (owner; reversible: archived -> previous status)
any except deleted -> deleting    (owner permanent delete; irreversible)
deleting -> deleted               (system, after deletion job succeeds; terminal)
capture-time failure (mic/upload) -> stays capturing/paused; failure is surfaced, not a state change
```

Forbidden examples (each has a unit test): start without consent; start from `processing/review/published/deleting/deleted`; stop from `scheduled`; publish from anything but `review`; any transition out of `deleting/deleted` other than `deleting -> deleted`. Every transition appends an `audit_event`.

Notes: `note.status` is `draft` until a person publishes; generated content is never auto-published. Publish requires an owned folder.

### 5.2 Job status

`pending -> running -> succeeded | retrying -> running ... | failed`. `retrying` carries `attempts` and `next_run_at` (capped exponential backoff with jitter). `failed` after max attempts; owner can re-enqueue (creates a new attempt chain on the same unique key). Replaying a succeeded job is a no-op.

## 6. Authorization boundaries

- Single role Owner; tenant boundary is `owner_id` on every row. Owner id comes from the session, never from request parameters or bodies.
- Every repository method takes `ownerId` and the SQL includes `owner_id = ?`. There are no unscoped lookups by id. Predicates (`canViewMeeting(owner, meeting)`) are pure and used by use cases as a second check.
- Covered surfaces: meetings, transcript, notes, folders, templates, search (owner filter inside the FTS query), Markdown export, audio file URLs (signed, short-lived, minted after the owner check, R2 keys prefixed `owner/<id>/`), job status polling, deletion, webhooks (resolve owner from the stored calendar connection, never from payload claims).
- Meetings in `deleting/deleted` behave as nonexistent (404) on every surface.
- Cross-owner access returns 404. Mandatory tests: owner-A-cannot-read/modify-owner-B plus a guessed-ID test per query/mutation.
- Sessions: HttpOnly, Secure, SameSite=Lax, rotation on login, idle and absolute expiry; sign-in rate-limited. CSRF on every mutation.
- Headers: CSP without inline script, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy: microphone=(self)`, `frame-ancestors 'none'`.

## 7. Background jobs

| Job | Trigger | Behavior |
|---|---|---|
| `transcribe` | Stop capture (unique per meeting) and owner retry | Processes chunks independently; idempotent by chunk key; writes segments under unique (chunk, index); resumes failed chunks; purges raw audio per chunk only after that chunk succeeded (default; configurable in settings); on completion enqueues `summarize` |
| `summarize` | After transcription; regenerate-selection | Calls `Summarizer`, verifies output server-side (attendees must be from the list or null, every section/decision has a valid source range, schema + length checks), stores a **draft**; idempotent per (meeting, revision) so retries do not create duplicate notes; regenerate replaces only the chosen section and keeps manual edits |
| `delete` | Owner permanent delete | Meeting already `deleting` (hidden everywhere). Removes object-store prefix, FTS rows, then DB rows; idempotent and retryable with backoff; leaves a content-free audit record; final state `deleted` |
| `retention` | Scheduled (Workers cron / Node interval) | Applies retention settings: purge leftover raw audio, optionally expire old notes/transcripts by enqueueing `delete` jobs |
| `calendar-sync` (optional) | Webhook event | Imports/updates meeting via `importEvent` use case; deduped by `ProviderEvent` |

Runners: Cloudflare Queues consumer + cron in production; an in-process runner (poll the `job` table) on Node for local dev and tests. Both call the same job handler functions; handlers are pure use cases with ports injected. Rough notes live on the `meeting` row and are never touched by job failure.

## 8. External adapters (ports and fakes)

Every adapter: timeout, normalized `ProviderError {kind: timeout|rejected|rate_limited|unavailable, retryable}`, deterministic fake, shared contract tests run against fake and real-with-stubbed-server, host allowlist and https only, no redirect to other hosts, secrets from env only and never logged. Env names are listed in `.env.example` (#23).

| Port | Real | Fake | Issue |
|---|---|---|---|
| `CalendarSource` | Google Calendar (OAuth, webhook with signature + dedupe) and ICS text/file import | Fixed events fixture, injectable failures | #7 |
| `Transcriber` | Configurable STT provider (HTTP) | Deterministic text per chunk; `failOnChunk(n)` | #8 |
| `Summarizer` | Configurable LLM provider (HTTP) | Deterministic structured output, including adversarial-transcript cases | #9 |
| `ObjectStore` | Cloudflare R2 (private) | Local filesystem | #10 |
| `JobQueue` | Cloudflare Queues | In-process runner | #11 |
| `Clock`, `IdGenerator`, `RateLimiter`, `Logger` | Platform | Fixed clock, sequential ids, in-memory limiter, capture logger | #3, #20 |

Calendar adapter details (#7): webhooks carry `X-Willy-Signature: t=<unix>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">` (5 min tolerance, constant-time compare, key `CALENDAR_WEBHOOK_SECRET`); the body is `{id, type, channelId, event}`, the Owner is resolved from `channelId` via our own connection records, and `id` is deduplicated in `ProviderEvent`. OAuth `state` is a stateless owner-bound HMAC with a 10 minute ttl; redirect URIs are exact-match allowlisted (`GOOGLE_OAUTH_REDIRECT_URIS`); Google tokens are sealed with AES-256-GCM (`TOKEN_ENCRYPTION_KEYS`, key id stored in the sealed value, owner bound as AAD). All outbound HTTP goes through `src/adapters/http/guarded-fetch.ts` (https, host allowlist, timeout, no redirects, normalized `ProviderError`). Persistence ports (`CalendarImportRepository`, `ProviderEventStore`, `CalendarConnections`, `CalendarCredentialStore`) ship with in-memory fakes; the D1 implementations land with the schema (#4) and the import screen (#14).

LLM safety: transcript text is untrusted data, never instructions; LLM output is data only, never used to choose tools, URLs or authorization. Calendar import never fetches an arbitrary URL taken from user or calendar content.

## 9. Local dev story and environments

- **Production**: Astro with `@astrojs/cloudflare`; D1, R2, Queues, cron; secrets as Worker secrets.
- **Local/CI default**: `npm run dev` runs Astro on Node with SQLite (same SQL dialect as D1; migrations applied by the same files), filesystem object store, in-process job runner, and **all providers faked**. `FAKE_PROVIDERS=1` is the default when no provider env vars are set; the Settings screen shows "fake mode" honestly.
- **Cloudflare parity check**: integration tests that need D1 semantics run against Miniflare/wrangler local D1; the rest use SQLite. CI never uses real providers or real secrets.
- One command `npm test` runs unit + integration + e2e against fresh, isolated data. Required scripts: `lint`, `typecheck`, `test`, `build`, `dev`.
- Seeds (`seeds/`): two distinct owners; for owner A a happy-path published meeting, an empty meeting, a failed transcription, an overdue action item, an archived meeting, a meeting in `deleting`; owner B has a meeting that A must not see.
- Browser e2e (Playwright) uses a fake `getUserMedia`/MediaRecorder source (Chromium fake-device flags) and the fake STT/LLM.

## 10. Coverage against `product.md`

| product.md section | Where addressed |
|---|---|
| Working agreement (plan before code) | This document |
| Journeys 1-3 | Pages 3.1; e2e #22 |
| Screens 1-4 and per-screen states | 3.1; each UI issue specifies empty, pending, success, validation, recoverable failure |
| Core capabilities 1-5 | meetings, transcription, notes (templates), search contexts |
| Business rules 1-4 | 5 (state machine), 6 (authz), 7 (jobs); invariants in domain + DB |
| Data model and lifecycle | 4 here; full detail in #4 |
| Users, auth, permissions | 6; #5 |
| Interaction and visual direction | 3.1 progressive enhancement; #14-#19, #21 |
| Technical direction and integrations | 8, 9; `.env.example` (#23) |
| Security and privacy | 3.2 guards, 6, 8; README security section (#23) |
| Acceptance scenarios 1-3 | Unit at domain (#6, #11, #13), e2e (#22) |
| Testing | `CLAUDE.md` section 3 pyramid; one command `npm test` |
| Operations | #20 (logs, correlation ids, `/healthz`, diagnostics); #23 (backup/restore, migrations, rollback) |
| Deliverables | README, `.env.example`, seeds, migrations (#3, #4, #23) |
| Non-goals | Section 1; reviewers reject any related work |

## 11. Open questions and chosen defaults

| # | Question | Default chosen (change by PR here) |
|---|---|---|
| 1 | Sign-in mechanism for production | Dev: seeded credentials. Production option documented in README: emailed magic link via a provider adapter; not built in this slice. |
| 2 | Deleting a folder that contains notes | Blocked with a clear message; owner must move or delete notes first. |
| 3 | Audio retention | Raw audio deleted per chunk after successful transcription; setting can extend retention up to a documented maximum (7 days), after which the `retention` job purges it. |
| 4 | Transcript/note retention | Kept until owner deletes; optional retention setting (off by default). |
| 5 | Live updates | Short polling of `/api/meetings/:id/status`; no SSE or Durable Objects (no proven real-time coordination need). |
| 6 | Diarization | Use speaker labels from STT when available, else a single `Speaker 1`; owner corrections are the source of truth. |
| 7 | Calendar providers | Google Calendar plus ICS text/file import; no Microsoft/Apple in this slice. |
| 8 | Consent statement text | Fixed, versioned string (`consent_statement_version`); changing the text bumps the version. |
| 9 | Max chunk size and duration | 1 MiB per chunk, 10-second chunks, max 4 hours per meeting; constants in domain policy, tested. |
| 10 | Encryption keys | AES-GCM envelope encryption; key from env, key id stored per record; rotation note in README. |
| 11 | Archive semantics | Hidden from the default list, still searchable only when "include archived" is set; reversible. |

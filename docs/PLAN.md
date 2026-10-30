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
| `GET /` | **Inbox** (screen 1, #14; Inbox in #72): what needs the owner, by status | **New note** | Status decides place. Sections, always in this order: **In progress** (`capturing`, `paused`, `processing`, and `failed`, which needs the owner like running work; newest first), **Upcoming** (`scheduled` and not over yet, soonest first; a meeting with no end counts one hour from its start), **Drafts to review** (`review`; newest first) and, only when there are any, **Past and not started** (`scheduled` and over; newest first). Each section has its own empty state with a next step, and is cut at 50 rows with "Showing 50 of N" and a link to All notes. Published and archived notes are not here (published ones live in folders and in All notes); deleting and deleted are never listed. Also on the page: the search box, a row of folder chips that link to `/folders/:id`, and the entry points New note, Import from calendar and Import from ICS file (a calendar outage shows its alert here). The old folder dropdown, Apply button and "Show archived" checkbox are gone (folders: the sidebar and chips; archived: the All notes filter). Meeting cards show status as text + marker. |
| `GET /notes?status=&folder=&page=` | **All notes** (#72): every non-deleted meeting of the owner, newest first | none (read-only) | Route decision: `/notes` (the Inbox is `/`, a note's own page is `/meetings/:id`). Filters are plain GET links, no form: a status segmented control (`all` default, `draft` = meeting in `review`, `published`, `archived`; `All` includes archived meetings, each card says "Archived") and folder chips (`folder=` shows published notes filed in that folder, the same rule as the folder view). The two filters combine and keep each other in their links. Unknown status values mean All; an unknown or other owner's folder id matches nothing ("No notes match" with a way out). 25 per page, `?page=` clamped like the folder view; junk is page 1. Deleting and deleted meetings are never listed or counted. Reached from the sidebar ("All notes"), the phone More menu and the Inbox. |
| `GET /meetings/new`, `POST /meetings/new` | New note form (title, local date and time, IANA tz, duration, agenda, attendees, template) | Create | The page handles its own POST: 422 with field errors, or 303 to `/?notice=created`. A hidden submission token makes a double submit create one meeting. |
| `GET /meetings/:id`, `POST /meetings/:id` | Screen 2: Live note (#15). Always available for the owner's meeting; after capture it shows the state and keeps rough notes editable, and the review screen (#16) takes over from there | **Start capture** (after consent) | Rough notes form; JS: MediaRecorder, level meter, timer, chunk upload with retry, `aria-live` status. |
| `GET /meetings/:id/review`, `POST /meetings/:id/review` | Screen 3: Review (#16) | **Publish to folder** | Transcript beside editable sections (stacked on phones, summary first); speakers, decisions, action items; regenerate-selection; failed/pending states with retry. The page handles its own form POST (PRG, 422 field errors, 409 wrong state) with an `intent` field, see section 3.2. Statuses before capture ends redirect to the live note. |
| `GET /search?q=&folder=` | Search results (#18) | Open result | Snippets with escaped highlights; owner-scoped FTS. |
| `GET /meetings/:id/review?src=<from>-<to>#seg-<n>`, `?q=&hit=<kind>:<id>` | Source context | | A section source link, or a search hit (#18), marks the cited segment range and the hit item. Both parameters are untrusted: a hit only counts when it names an item of this note. Server-rendered; a small script moves the marks in place without losing unsaved edits. |
| `GET /settings` | Screen 4: Settings (#19, #17) | | Sections: provider status, retention, folders, templates, export, permanent deletion. |
| `GET /settings/templates`, `/settings/templates/new`, `/settings/templates/:id`, `/settings/templates/:id/delete` | Template list, editor and delete confirmation (#17) | Save | Pages handle their own form `POST` (re-render with field errors on failure, redirect with a fixed notice code on success). |
| `GET /folders`, `/folders/:id`, `/folders/:id/delete` | Folders index (create, rename; every folder links to its view, with its count), the read-only folder view (#67) and delete confirmation (#17) | Create (index) | `/folders/:id` is server-rendered and works without JS: breadcrumb `Folders > name`, count, the owner's **published** notes newest meeting first as `MeetingCard`s, 25 per page (`?page=`, clamped; junk is page 1), empty state ("Nothing published here yet"). Archived, `deleting` and `deleted` meetings are never listed or counted. Foreign and unknown ids: the same plain 404. No mutation on this page (inline create/rename and moving from the list are later increments; a note moves from its review header, #76). `/settings/folders` and `/settings/folders/:id/delete` answer **308** to the new URLs (any method), so old bookmarks and forms still work. "Folders" is a main-nav entry (in the shell, the folder list and "All folders"); the Inbox shows folder chips linking to `/folders/:id`, and All notes uses folder chips as filters. The Inbox, All notes and the folder view render their cards through one component (`NoteList` over `MeetingCard`, rows from `meeting-list-row.ts`) and share one `Pager`, so they cannot drift. |
| `GET /sign-in`, `GET /signed-out`, `GET /session-expired`, `GET /forbidden-or-not-found` (rendered as the 404 body) | Auth states (#5) | | Understandable signed-out / expired / not-found pages. |
| `GET /healthz` | Liveness, status only (`{"status":"ok"}`), no data (#20) | | |
| `GET /diagnostics` | Authenticated diagnostics: migration version, job counts, provider status (#20) | | No transcript or audio content. |

### 3.2 Form actions and endpoints (all `POST` unless stated)

| Endpoint | Purpose | Idempotency / guards |
|---|---|---|
| `POST /sign-in`, `POST /sign-out` | Session create/destroy (rotate id on login) | Rate-limited; CSRF on sign-out |
| `POST /meetings/new` | Create meeting | Idempotency key from the form (hidden token, `idempotency_key` scope `create_meeting`) |
| `POST /meetings/:id` (`intent=save_notes|start|pause|resume|stop`), `POST /api/meetings/:id/notes` (JSON autosave `{roughNotes}`) | Rough notes, consent + capture controls | The page handles its own form POST (PRG). Last write wins; rough notes saved in any state except `deleting/deleted`; `start` records consent first and the server refuses without the tick |
| `POST /meetings/import` | Import upcoming events from the connected calendar provider | Unique on (owner, provider, provider_event_id): same event twice = one Meeting. Rate-limited |
| `GET /meetings/import/ics`, `POST /meetings/import/ics` | ICS file import (#57): the upload/paste form, and the preview it renders (multipart: `file` or `ics_text`, `floating_zone`) | Parsed in memory, nothing stored or fetched. Limits: 1 MB, 200 events, 64 KB line, UTF-8, `.ics`/text allowlist; reject, never truncate. Body capped at 4 MB from `Content-Length` before any read (413/411). CSRF; rate-limit class `import-ics` (40 per 10 min per owner, shared with confirm) |
| `POST /meetings/import/ics/confirm` | Import the ticked events of the previewed file (303 to `/?notice=ics_imported`) | The file text comes back in a hidden field and is parsed again, so only parser output is imported. Every ticked id must be an importable event of that file or nothing is written (cancelled, series masters and foreign ids included). Owner from the session; unknown fields rejected. Idempotent via `upsertFromCalendar` keyed `(owner, 'ics', stable id)` |
| `POST /meetings/:id/consent` | Owner confirms consent statement | Sets `consent_confirmed_at`, `consent_statement_version`; append-only; repeat is a no-op |
| `POST /meetings/:id/capture/start`, `/pause`, `/resume`, `/stop` | Capture lifecycle | Server rejects start without stored consent; `stop` enqueues exactly one transcription job (unique job key `(meeting_id, 'transcribe')`) |
| `POST /api/meetings/:id/chunks` (`PUT`-like body, raw audio) | Chunk upload | Owner + status `capturing/paused`, max bytes per chunk, max chunks/duration, audio content-type allowlist, `Idempotency-Key`/sequence number unique per meeting, rate-limited. Reject, never truncate. `409` has two bodies: `meeting_not_capturing` (capture ended) and `chunk_conflict` (the number holds different audio, e.g. a reload racing the old page's last upload); the client moves a conflicting chunk to the next free number instead of dropping it (#65) |
| `GET /api/meetings/:id/status` | Poll capture/processing status for live updates | Owner-scoped, returns state + job states only (SSE is not planned; polling is enough). Rate-limited (`status`, 120/min per owner). Polled by the live note, review and home (#51) |
| `GET /api/deletions/status` | Poll the owner's recent permanent-deletion jobs (settings screen, #51) | No id in the URL: the owner comes from the session, so another owner's rows are never reachable. Per job: meeting id, state, attempt counts, next run time, error code. No titles or content. Same `status` rate limit |
| `POST /meetings/:id/review` (`intent=` below) | One endpoint for the review screen; unknown or repeated fields, unknown intents and malformed ids are 400 | Owner and meeting from session and path; other owners' and unknown ids and items are 404; edits only while the meeting is in `review` (409 otherwise) |
| `intent=retry_transcription` | Retry failed transcription | Re-enqueues only failed chunks (unique job key); no duplicate segments; a second click is a no-op |
| `intent=rename_speaker` / `merge_speaker` (`from`, `to`) | Rename or merge speaker labels | Applied to every segment of this meeting in one statement; the original label is kept; merging = renaming to an existing label |
| `intent=edit_section` (`id`, `body`), `add_decision`, `edit_decision`, `delete_decision` | Edit summary sections and decisions | Marks the item `edited`, raises the note revision (so a queued regeneration of an older revision becomes stale and cannot overwrite the edit), refreshes the search row, one transaction |
| `intent=add_action_item`, `edit_action_item`, `delete_action_item` (`text`, `assignee`, `due`, `done`) | Action items | Owner must be an Attendee of the meeting or empty; a due day is stored as the end of that day in the meeting zone (UTC instant + tz) |
| `POST /meetings/:id/note/regenerate` | Regenerate-selection (one section) | Creates a summary job keyed by (note, section, revision) |
| `intent=publish` (`folder`, `confirm`), `intent=reopen` | Publish the draft to a private folder, or reopen it as a draft | Confirmation field required; repeat publish is a no-op (no second audit event); folder must belong to the Owner (a foreign folder is a validation error); note and meeting change in one transaction |
| `intent=move_note` (`folder`) | Move a **Published** note to another of the owner's folders without reopening it (#76). Use case `moveNoteToFolder(deps, ownerId, meetingId, folderId)` in `src/app/notes/move-note.ts`; the rule is the pure `planNoteMove` in `src/domain/notes/move.ts` | Owner from the session. Only a Published note (meeting and note both `published`; a draft, archived, processing, failed or other-state note is a **409** and never moves); an unknown or another owner's meeting is a **404** (deleting meetings too); the target must be one of the owner's folders, and a missing or foreign folder is the same **422** field error ("That folder is not available"), so ids cannot be probed. Moving into the folder it is already in is a no-op (notice "Already in <folder>", no write, no second event). Not a lifecycle transition: the note stays Published and its content, revision and `published_at` are untouched (only `note.folder_id` and `updated_at`). One append-only `audit_event` `note.moved` (`actor: owner`, `detail_json: {fromFolderId, toFolderId}`, ids only, never titles or content) is written in the same transaction as the update, which is guarded by `status = 'published' AND folder_id IS <from>` (a concurrent reopen or move becomes a `conflict`, retried once, then a 409). Redirects 303 to `/meetings/:id/review?notice=moved#move-folder` (the notice text names the folder the page reads from the database, never the URL). No migration: `note.folder_id` and its composite FK already existed. |
| `POST /folders` (`intent=create|rename`), `POST /folders/:id/delete` | Folder CRUD | Delete of a non-empty folder is **blocked** with a message (default; see open questions); unique name per owner, case-insensitive |
| `POST /settings/templates/new`, `/settings/templates/:id`, `/settings/templates/:id/delete`, `POST /settings/templates` (`intent=set_default`) | Template CRUD | At most 12 sections, validated lengths, unique headings; deleting a template detaches the meetings that used it (they fall back to the default) |
| `POST /settings` | Retention controls (the settings page handles its own form POST; 422 with field errors) | Validated against fixed choices; turning note expiry on or shortening it needs an acknowledgement tick |
| `POST /settings/deletions/:meetingId/retry` | Retry a failed deletion job | Owner-scoped; 404 for others; requeues only a `failed` job |
| `GET /meetings/:id/export.md` (names only, no emails, no transcript; ASCII filename; `nosniff`) | Markdown export | `GET` is safe (read-only); owner-scoped; sanitized filename; `Content-Disposition: attachment`; `X-Content-Type-Options: nosniff`; rate-limited |
| `GET/POST /meetings/:id/delete` | Permanent deletion (#19): GET shows the scope text and confirmation form, POST needs the typed word `DELETE` and calls `requestMeetingDeletion` | Typed confirmation; marks `deleting` and enqueues one deletion job; repeat is a no-op |
| `POST /webhooks/calendar` | Inbound provider webhook | Signature verified (constant time, timestamp tolerance); dedupe by provider event id in `ProviderEvent`; no session, no CSRF (signature instead); rate-limited |
| `GET /oauth/calendar/start`, `GET /oauth/calendar/callback` | Google OAuth connect | `state` bound to session, redirect URI checked against allowlist, tokens encrypted at rest. `start` mutates nothing durable beyond the state nonce |
| `GET /api/files/:token` | Short-lived authorized file URL (audio while it exists) | Token minted only after owner check, TTL <= 5 min; 404 after deletion |
| `POST /internal/jobs/run` (dev/Node only) | Runs the signed-in owner's due jobs once (never another owner's) | Disabled in production builds; not exposed on Workers |

### 3.3 UI conventions

The visual reference is `DESIGN.md` (repo root, owner-supplied). Its tokens are defined once in `src/styles/tokens.css`; every other stylesheet and component reads them and never types a colour or radius (enforced by `tests/unit/styles/design-tokens.test.ts`). One acid-lime `button-primary` per view, all other buttons ghost, destructive buttons keep their words. Accessibility rules override the reference where they conflict (44px hit areas, no Ash text, status by text and marker, 1px hairlines); the list is in the README "Design" section. Page frame: the **app shell** (#70), which departs from `DESIGN.md` (no sidebar, 1200px page) with the owner's approval: a sticky 15rem sidebar from 60rem (wordmark, **New note**, Inbox, All notes, Search, the owner's first eight folders with counts plus "All folders", Templates, Settings, signed-in name, Sign out) and, below 60rem, a top bar (wordmark, New note) with a fixed bottom tab bar (Inbox, Search, Folders, More; All notes, Templates and Settings are in More). The 1200px measure now applies to the content column beside the sidebar. The shell is server-rendered in `Base.astro` with no client JavaScript (the phone's More menu is a `<details>`); the folder list comes from `loadShellFolders` (owner-scoped `FolderRepository.list(ownerId, limit)`, counts only). Standalone pages (sign-in, signed-out, session-expired, 403/429/500) have no shell. New note is the shell's lime action and steps back to a default button when the page has its own `button-primary`, so a view never has two lime actions. **Meeting header and status words (#73).** One component, `src/components/MeetingHeader.astro`, heads `/meetings/:id` and `/meetings/:id/review`: title (read-only), date/time with the zone's short name, the status word, the folder chip (a link to `/folders/:id`, only once the note is published into it) and the template chip (a link to `/settings/templates/:id`, whenever one is set), the stepper and the stage's one action. The words, steps and action are pure domain rules in `src/domain/meetings/stage.ts`, read by the header, the cards (`describeMeeting`) and the progress text (`src/domain/progress/text.ts`), so one status has one word everywhere:

| Status | Word | Stepper |
|---|---|---|
| `scheduled` | Scheduled | step 1 of 5 |
| `capturing` | Recording | step 2, Capturing |
| `paused` | Recording paused | step 2, Capturing ("paused" in the summary) |
| `processing` | Processing | step 3 |
| `failed` | Needs attention | step 3, Processing, with the phrase "Needs attention" on screen and a dashed ring plus "!" |
| `review` | Draft (the header adds "Not published") | step 4 |
| `published` | Published | step 5 |
| `archived` | Archived | no stepper: its own state, "This note is archived." |
| `deleting`, `deleted` | none (a 404) | none |

The stepper is an ordered list (`aria-label="Note stage"`) with `aria-current="step"` on the current step; each step has a marker (tick, number or "!"), its name and its state in words (`Done`, `Current step`, `Upcoming`, `Needs attention`), and a visible summary line ("Step 4 of 5: Draft"). Below 40rem only the current step keeps its word on screen. Tokens only; reduced motion needs nothing (no animation); forced-colors keeps the borders. `src/scripts/progress/stage-sync.ts` (called by the existing polling script when it reads a status) updates the stepper and the word in place when a hand-off settles, from the same domain functions, so a live update and a reload agree. The action per stage is a link to where the action lives (the forms keep their own buttons, fields and handlers): live note: Scheduled, **Start capture** (lime, to the consent statement; the form's own button is a default button); Capturing and paused, none (recording is a state, not an invitation; Resume stays lime in the capture panel); Processing, none (the hand-off block's link appears when ready); Draft, **Open the draft**; Needs attention, **See what happened and retry**; Published, a secondary **Open the published note**. Review: Draft, **Publish to folder** (lime, to the publish form, whose own button is a default button); Published, a secondary **Reopen for editing**; Processing and Needs attention, none (the retry button keeps its panel and is the lime action). Still one lime action per view: where a stage has none, the shell's New note is lime. Not in this increment: merging the two pages (4b), inline editing (6a), moving notes (3b), the Inbox and All notes pages, the command palette. **Move to folder (#76).** The review header of a Published note (and only then) gets a `move` slot under the folder chip: a `<details class="move-folder">` whose summary is a default (ghost) button "Move to folder" (44px, never lime), holding a form with a labelled select of the owner's other folders and a default "Move" button (`intent=move_note`, section 3.2; works without JavaScript). With no other folder it says so and links to `/folders`. After the redirect the summary (`#move-folder`) is focused, so focus returns to the control next to the chip it changed, and the `role="status"` notice says "Moved to <folder>." (or "Already in <folder>."); errors show the page alert plus a field error and keep the form open. Folder counts and the sidebar are computed from `publishedCount`, so they follow. Not on the live note page, the folder view or All notes: those come with the palette/drag increments (3c, 8a).

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
| `audit_event` | Append-only history (consent, transitions, deletion record, `note.moved`) | owner_id | no UPDATE/DELETE path; deletion leaves a content-free record |
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
| `CalendarSource` | Google Calendar (OAuth, webhook with signature + dedupe). ICS file import does not use this port (see decision 7) | Fixed events fixture, injectable failures | #7 |
| `Transcriber` | Deepgram (HTTP) or local whisper.cpp (spawned `ffmpeg` + `whisper-cli`, Node only) | Deterministic text per chunk; `failOnChunk(n)` | #8, #56 |
| `Summarizer` | Configurable LLM provider (HTTP) | Deterministic structured output, including adversarial-transcript cases | #9 |
| `ObjectStore` | Cloudflare R2 (private) | Local filesystem | #10 |
| `JobQueue` | Cloudflare Queues | In-process runner | #11 |
| `Clock`, `IdGenerator`, `RateLimiter`, `Logger` | Platform | Fixed clock, sequential ids, in-memory limiter, capture logger | #3, #20 |

Calendar adapter details (#7): webhooks carry `X-Willy-Signature: t=<unix>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">` (5 min tolerance, constant-time compare, key `CALENDAR_WEBHOOK_SECRET`); the body is `{id, type, channelId, event}`, the Owner is resolved from `channelId` via our own connection records, and `id` is deduplicated in `ProviderEvent`. OAuth `state` is a stateless owner-bound HMAC with a 10 minute ttl; redirect URIs are exact-match allowlisted (`GOOGLE_OAUTH_REDIRECT_URIS`); Google tokens are sealed with the shared envelope `TextCipher` (`ENCRYPTION_KEYS`, key id stored with the ciphertext, owner bound as context). All outbound HTTP goes through `src/adapters/http/guarded-fetch.ts` (https, host allowlist, timeout, no redirects, normalized `ProviderError`). Persistence ports (`CalendarImportRepository`, `ProviderEventStore`, `CalendarConnections`, `CalendarCredentialStore`) ship with in-memory fakes; the D1 implementations land with the schema (#4) and the import screen (#14).

Local Whisper adapter (#56, `STT_PROVIDER=whisper`, `src/adapters/stt/whisper-cpp-transcriber.ts`): free speech-to-text where audio never leaves the machine (Anthropic APIs do not accept audio). Decision: **spawn local binaries rather than call a local Whisper HTTP server.** Reasons: the Homebrew `whisper-cpp` formula builds `whisper-cli` but not `whisper-server` (`-DWHISPER_BUILD_SERVER=OFF`), so a server would mean compiling from source or running faster-whisper-server/Docker; a process has no listening port, so there is no SSRF or loopback-exposure surface to police; and the stub is simply a command runner. Cost: the model is loaded for every 10 s chunk (a fixed delay). Browsers record webm/opus (Chrome, Firefox), ogg/opus (Firefox) or mp4/aac (Safari), none of which whisper.cpp reads, so `ffmpeg` converts every chunk to 16 kHz mono WAV first (documented prerequisite, nothing bundled). Each chunk: private mode-0700 temp directory (random name, fixed file names, nothing derived from ids or content), `ffmpeg` with the demuxer forced from the allowlisted content type and `-protocol_whitelist file` (a crafted upload cannot make it open other files or URLs), then `whisper-cli -oj`, parsed from its JSON (`offsets` are milliseconds relative to the chunk, so segments are deterministic for the same audio and model), directory removed in `finally`. Spawning goes through `src/adapters/process/run-command.ts`: fixed argv array, no shell, minimal environment (no secrets), output discarded, SIGKILL at the deadline; one time budget covers both steps and starts when a concurrency slot is free (`STT_WHISPER_MAX_CONCURRENCY`, default 1, max 4). Errors: missing program or model, or a crash = `unavailable` (retryable); undecodable audio (ffmpeg fails) = `rejected`; deadline = `timeout`; never `rate_limited`. Whisper has no diarization (all "Speaker 1"); `[BLANK_AUDIO]`-style annotations are dropped. Node/self-hosted only: Workers cannot spawn processes and keep using a network provider.

ICS import details (#57): `src/domain/calendar/ics.ts` is a pure, bounded RFC 5545 subset parser (no dependency, no I/O): VEVENT with UID, SUMMARY, DTSTART/DTEND/DURATION, ORGANIZER, ATTENDEE, LOCATION, DESCRIPTION, STATUS, SEQUENCE, RECURRENCE-ID; unfolding, text escapes, `Z`/floating/`TZID` times, all-day dates, CRLF/LF/CR and a BOM. Content lines are scanned, never matched with backtracking regexes. `windows-timezones.ts` maps the CLDR Windows zone names Outlook writes to IANA; `local-time.ts` converts wall time to UTC with `Intl` following RFC 5545 for DST gaps (offset before the gap) and overlaps (first occurrence). The stored `provider` is `ics` (already allowed by the `meeting.calendar_provider` CHECK in migration 0001, so no migration) and `provider_event_id` is the UID, or `UID|<replaced instant as YYYYMMDDTHHMMSSZ>` for a RECURRENCE-ID override. A file with the same UID twice keeps the highest SEQUENCE (later wins ties). A file over a limit, not a calendar, or malformed is rejected whole; one bad event is skipped and listed while the others import. Missing DTEND uses DURATION, an all-day event is one day, otherwise the new-note default length. Descriptions and locations are display-only plain text in the preview and are not stored. Logs carry counts only.

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
| 5 | Live updates | Short polling of `/api/meetings/:id/status` and `/api/deletions/status`; no SSE or Durable Objects (no proven real-time coordination need). Progressive enhancement only (`src/scripts/job-progress.ts`): pages are complete server-rendered and keep their "Check again" link. The script waits 2-4 s before the first poll, backs off to 30 s while nothing changes (capped, jittered, reset on news), honours `Retry-After` on 429, does not request while the tab is hidden, stops on a terminal state, after 5 consecutive failures or after 30 minutes (and says so in the live region), and watches at most three elements per page. Words come from `src/domain/progress/text.ts`, shared with the server render, so a live update and a reload agree. Changes are announced through `role="status"` regions (`aria-atomic` where a whole list is one message). **Live note after Stop (#66, which deliberately bends the #63 "link, not redirect" rule):** the page shows a hand-off block (`src/domain/progress/handoff.ts`, shared with the server render) with real counts from the status endpoint's existing `chunks` counters ("Transcribing: 2 of 7 parts", then "Writing the draft"; ids and counts only, never transcript text, nothing new on the endpoint) and a bar. It has one polite `role="status"` line of its own that is written only at stage changes, not on every count, so a screen reader is not read each poll. When the status settles, the block becomes one primary (acid lime) link: "Open the draft" at `review`, "See what happened and retry" at `failed` (the retry lives on the review page). Its `href` is rendered by the server from the meeting id of the page, never from a response, and the same link is server-rendered at those statuses. **Auto-open:** at `review` the page navigates to the draft by itself only when the owner is not typing: focus is not in an input, textarea, select or contenteditable, and the rough notes have no unsaved changes (the autosave sets `data-unsaved` on the textarea). It first says "Draft ready, opening it." in the status line, waits 1.5 s so that is heard, asks the rule again (the owner may have started typing meanwhile) and then navigates. Otherwise it keeps the button and says "Draft ready. Use the Open the draft button." It never moves focus, never opens on `failed`, never opens on page load (a reload at `review` shows the button, which is also the no-JS path), and the tab title gains a "Draft ready" prefix for someone in another window. `prefers-reduced-motion` turns off the button's short fade; a page change is not an animation, so it does not stop the navigation. |
| 6 | Diarization | Use speaker labels from STT when available, else a single `Speaker 1`; owner corrections are the source of truth. |
| 7 | Calendar providers | Google Calendar plus ICS text/file import; no Microsoft/Apple API in this slice. ICS (#57) is how Microsoft 365 / Outlook / Teams users bring meetings in without an Entra app: it needs no OAuth, token or network call, and is a dedicated use case (`src/app/calendar/import-ics.ts`) over the same `CalendarImportRepository`, not a `CalendarSource`. Recurring series (`RRULE`/`RDATE`) are reported in the preview and not expanded; explicit single events and `RECURRENCE-ID` overrides are imported. |
| 8 | Consent statement text | Fixed, versioned string (`consent_statement_version`); changing the text bumps the version. |
| 9 | Max chunk size and duration | 1 MiB per chunk, 10-second chunks, max 4 hours per meeting; constants in domain policy, tested. |
| 10 | Encryption keys | AES-GCM envelope encryption; key from env, key id stored per record; rotation note in README. |
| 11 | Archive semantics | Hidden from the default list, still searchable only when "include archived" is set; reversible. |

# Willycrumbs data model

Status: v1 (issue #4). Source of truth for the schema is `migrations/`; this document explains it. Names follow `product.md` (Meeting, Attendee, TranscriptSegment, Note, ActionItem, Folder, Template, Owner) and the state machine in `docs/PLAN.md` section 5. Change a shared table by a small PR that edits this file and adds a **new** migration; never edit a merged migration.

## 1. Conventions

- **Engine**: SQLite dialect compatible with Cloudflare D1. Locally and in CI the same files run on `node:sqlite`; production applies them with `wrangler d1 migrations apply`. Migration files use only features D1 supports (CHECK, composite FK, partial/unique indexes, generated columns, triggers, FTS5). No `PRAGMA` and no `BEGIN`/`COMMIT` inside a migration; the runner wraps each file in one transaction. Connections must enable `PRAGMA foreign_keys = ON` (D1 always does; `openDatabase` does it locally).
- **Ids**: `TEXT` primary keys produced by the injected `IdGenerator` (never by the database, never `Math.random`).
- **Instants**: UTC ISO-8601 text ending in `Z` (`2026-10-27T09:30:00.000Z`), enforced by a `CHECK (col GLOB '????-??-??T??:??:??*Z')`. Anything that is a local schedule or due date stores the IANA zone name next to it (`meeting.timezone`, `action_item.due_timezone`).
- **Tenant boundary**: every table that holds user data has its own `owner_id` (not only via a parent) and every query includes `owner_id = ?` taken from the **session**. Child tables use **composite foreign keys** `(owner_id, parent_id) -> parent(owner_id, id)`, so the database itself refuses a child that belongs to a different owner than its parent. Parents therefore declare `UNIQUE (owner_id, id)`.
- **Enums** are `TEXT` with a `CHECK (col IN (...))`. The domain owns the transition rules; the CHECK only rejects values that cannot exist.
- **Nullable references and `SET NULL`**: a composite FK cannot `SET NULL` without nulling `owner_id`, so those references use `NO ACTION` (checked at statement end). Use cases clear the reference first inside the same transaction (for example `UPDATE meeting SET template_id = NULL` before deleting a template).
- **Naming**: the account table is `owner` (ubiquitous language), not `user`.
- **Encryption**: transcript text and long-lived provider tokens are stored as envelope-encrypted ciphertext plus the `key_id` that wrapped the record key (`src/adapters/crypto/envelope-cipher.ts`, AES-256-GCM, record key wrapped by a key from env; ciphertext is bound to its row through AAD, so values cannot be moved between rows). Audio chunks are encrypted by the storage adapter (#10); the row stores only metadata and the `key_id`.

## 2. Tables

### 2.1 identity

| Table | Purpose | PK | Timestamps | Status fields | Key attributes / constraints |
|---|---|---|---|---|---|
| `owner` | The single role. Several rows exist only for tenant isolation. | `id` | `created_at` | none | `email` UNIQUE NOCASE and stored lower-case; `display_name`; `password_hash` nullable (seeded dev credentials; hashing in #5). |
| `session` | Server-side session. | `id` | `created_at`, `last_seen_at`, `idle_expires_at`, `absolute_expires_at`, `revoked_at` | derived: revoked or expired | `token_hash` UNIQUE (the cookie value is never stored), `csrf_secret`; FK `owner_id`. Idle and absolute expiry enforced by the identity domain; `CHECK (idle_expires_at <= absolute_expires_at)`. Index `(owner_id)`. |

### 2.2 notes support: folders and templates

| Table | Purpose | PK | Timestamps | Key attributes / constraints |
|---|---|---|---|---|
| `folder` | Private publish target. | `id` | `created_at`, `updated_at` | `UNIQUE (owner_id, name COLLATE NOCASE)`, `UNIQUE (owner_id, id)`, name 1..100 chars. Deleting a non-empty folder is blocked by the use case; the FK from `note` (NO ACTION) is the backstop. |
| `template` | Meeting-type template (recurring meetings). | `id` | `created_at`, `updated_at` | `name` 1..100 unique per owner, `sections_json` (`json_valid`, array of `{heading, prompt}`), `is_default`; partial unique index: at most one default per owner. |

### 2.3 meetings (aggregate root and children)

| Table | Purpose | PK | Timestamps | Status fields | Key attributes / constraints |
|---|---|---|---|---|---|
| `meeting` | Aggregate root: the meeting, agenda, rough notes, consent record, capture window. | `id` | `created_at`, `updated_at`, `scheduled_start_at`, `scheduled_end_at`, `consent_confirmed_at`, `capture_started_at`, `capture_ended_at`, `archived_at`, `deleted_at` | `status` (see section 4), `status_before_archive` | `timezone` (IANA name, 1..64), `title` 1..200 (empty only when `deleted`), `agenda` and `rough_notes` (length limited), `consent_statement_version`, `calendar_provider` + `provider_event_id`, `template_id`. See consent CHECK below. |
| `attendee` | Person on a meeting. Never auto-added by the system; never implies consent. | `id` | `created_at` | none | `name` 1..200, `email` optional (minimum data), lower-case; `UNIQUE (meeting_id, email)` (NULLs allowed); composite FK `(owner_id, meeting_id)`. |
| `audio_chunk` | Metadata of one uploaded encrypted chunk. | `id` | `created_at`, `transcribed_at`, `purged_at` | `state`: `uploaded`, `transcribed`, `failed`, `purged` | `seq >= 0`; `UNIQUE (meeting_id, seq)` is the upload idempotency key; `byte_size` 1..1 MiB; `duration_ms` 1..60000; `content_type` allowlist; `sha256`; `key_id`; `object_key` (NULL iff `purged`); `transcription_attempts`, `last_error_code`. |
| `transcript_segment` | TranscriptSegment, encrypted. | `id` | `created_at`, `updated_at` | none | Composite FK `(owner_id, meeting_id, chunk_seq) -> audio_chunk`; `seg_index` 0..9999; **`UNIQUE (meeting_id, chunk_seq, seg_index)`** makes transcription idempotent (replay cannot create duplicates); generated `position = chunk_seq * 10000 + seg_index` orders the transcript and is what source ranges point at; `start_ms <= end_ms`; `speaker_label` (owner corrections update this column; the label the STT provider returned is `speaker_label_original`); `text_ciphertext` + `text_key_id`. |

Consent invariants (DB backing for `product.md` rule 1, in addition to the domain function `startCapture`):

- `CHECK ((consent_confirmed_at IS NULL) = (consent_statement_version IS NULL))`.
- `CHECK (status NOT IN ('capturing','paused','processing','review','published','failed') OR consent_confirmed_at IS NOT NULL)`: no meeting can be in or past capture without a stored consent time.
- `status = 'deleted'` requires a scrubbed row: `title = ''`, `agenda`, `rough_notes`, `provider_event_id`, `calendar_provider` all NULL.

Other meeting constraints: `UNIQUE (owner_id, id)`; partial `UNIQUE (owner_id, calendar_provider, provider_event_id) WHERE provider_event_id IS NOT NULL` (importing the same event twice yields one Meeting; a different owner may import the same provider event); `CHECK (scheduled_end_at IS NULL OR scheduled_end_at >= scheduled_start_at)`; `status_before_archive` is set iff `status = 'archived'`.

### 2.4 notes (derived, editable, draft until published)

| Table | Purpose | PK | Timestamps | Status fields | Key attributes / constraints |
|---|---|---|---|---|---|
| `note` | One Note per meeting (current revision). | `id` | `created_at`, `updated_at`, `generated_at`, `published_at` | `status`: `draft`, `published` | `UNIQUE (meeting_id)`, `UNIQUE (owner_id, meeting_id, id)`, `revision >= 1`, `folder_id`. `CHECK ((status = 'published') = (published_at IS NOT NULL AND folder_id IS NOT NULL))`: generated content cannot be published without a person choosing a folder. Composite FKs `(owner_id, meeting_id)` and `(owner_id, folder_id)`. |
| `note_section` | Summary section with source link to the transcript. | `id` | `created_at`, `updated_at` | `edited` (0/1; regeneration preserves edited sections) | `position`, `heading`, `body`, `source_from`/`source_to` (transcript `position` range; both NULL or both set; `from <= to`), `UNIQUE (note_id, position)`. |
| `decision` | Decision with source range. | `id` | `created_at`, `updated_at` | `edited` | `position`, `text`, `source_from`/`source_to` as above. Never invented: use cases reject decisions with no source range from the generator. |
| `action_item` | ActionItem. | `id` | `created_at`, `updated_at`, `due_at` | `status`: `open`, `done`; `edited` | `text`, `assignee_attendee_id` (NULL or an Attendee **of the same meeting and owner**, enforced by composite FK `(owner_id, meeting_id, assignee_attendee_id) -> attendee(owner_id, meeting_id, id)`), `due_at` + `due_timezone` (both or neither), `meeting_id` denormalised from the note for that FK and for the overdue query. |

### 2.5 operations and integrity

| Table | Purpose | PK | Key attributes / constraints |
|---|---|---|---|
| `job` | Background job state. | `id` | `kind` (`transcribe`, `summarize`, `delete`, `retention`, `calendar_sync`), `job_key` **UNIQUE** (for example `transcribe:<meetingId>`; stop-capture twice enqueues exactly one), `status` (`pending`, `running`, `succeeded`, `retrying`, `failed`), `attempts <= max_attempts`, `next_run_at`, `last_error_code` (a code, never content), `payload_json` (ids only). Index `(status, next_run_at)` for runners and `(owner_id, meeting_id)` for status polling. |
| `audit_event` | Append-only history: consent confirmation, every state transition, deletion record. | `id` | `kind`, `actor` (`owner`, `system`), `detail_json` (ids and states only), `occurred_at`. **Triggers abort UPDATE and DELETE.** `meeting_id` has no FK so a content-free record survives forever; it holds no title or text. Index `(owner_id, meeting_id, occurred_at)`. |
| `provider_event` | Inbound webhook dedupe. | `id` | `UNIQUE (provider, event_id)`; `owner_id` nullable until resolved from the stored connection. |
| `idempotency_key` | Submission dedupe (create meeting, publish, delete, import). | `(owner_id, scope, key)` | `resource_id` the first outcome points at, `created_at`, `expires_at`. |
| `provider_token` | Encrypted OAuth tokens. | `id` | `UNIQUE (owner_id, provider)`, `access_ciphertext`, `refresh_ciphertext`, `key_id`, `expires_at`. |
| `settings` | Retention preferences. | `owner_id` | `raw_audio_retention_hours` (0 = delete right after transcription, the default; max 168 = 7 days), `note_retention_days` (NULL = keep), `updated_at`. |
| `search_index` | Derived FTS5 index (rebuildable). | `rowid` | Columns `title`, `body` (indexed) and `owner_id`, `meeting_id`, `kind`, `ref_id` (UNINDEXED). Always queried with `owner_id = ?`. See section 5. |
| `schema_migrations` | Created by the runner, not by a migration. | `version` | `name`, `checksum`, `applied_at`. |

## 3. Indexes needed by the four screens

| Screen / query | Index |
|---|---|
| Screen 1: upcoming and recent meetings | `meeting (owner_id, scheduled_start_at DESC)`; `meeting (owner_id, status)`; folder filter via `note (owner_id, folder_id)`; note status via `note (meeting_id)` unique |
| Screen 2: live note | primary keys; `attendee (meeting_id)`; `audio_chunk (meeting_id, seq)` unique |
| Screen 3: review | `transcript_segment (meeting_id, position)`; `note_section (note_id, position)`; `decision (note_id, position)`; `action_item (owner_id, meeting_id)` |
| Overdue action items | `action_item (owner_id, status, due_at)` |
| Screen 4: search | FTS5 `search_index` filtered by `owner_id`; settings by PK |
| Job runner / polling | `job (status, next_run_at)`, `job (owner_id, meeting_id)` |

## 4. Lifecycle and state transitions

Meeting status (`CHECK` allows exactly these values; the transition table in `src/domain/meetings` (#6) is the rule):

```
scheduled -> capturing            owner, only with stored consent
capturing <-> paused              owner
capturing|paused -> processing    owner (stop); enqueues exactly one transcribe job
processing -> review              system (transcription + draft summary done)
processing -> failed              system (retries exhausted); recoverable
failed -> processing              owner retry (failed chunks only)
review -> published               owner (publish to an owned folder)
published -> review               owner reopen; note returns to draft
scheduled|review|published|failed -> archived   owner; reversible (status_before_archive)
any except deleted -> deleting    owner; irreversible
deleting -> deleted               system after the deletion job; terminal
```

Who triggers: only the Owner via a POST, or the system via a job. Terminal: `deleted` (and `deleting` can only move to `deleted`). Reversible: `capturing <-> paused`, `published -> review`, archive. Every transition appends an `audit_event` in the same transaction as the status change. Note status: `draft` until a person publishes; `published -> draft` on reopen. Job status: `pending -> running -> succeeded | retrying -> running ... | failed`; replaying a succeeded job is a no-op. Audio chunk: `uploaded -> transcribed -> purged`, `uploaded|failed -> transcribed`, `uploaded -> failed`.

**Immutable history**: `audit_event` only (triggers). Consent time is also stored on `meeting` (append-only in practice: the use case sets it once; repeat confirmation is a no-op) and recorded as an audit event.

## 5. Search, archive, retention, deletion

- **Search scope (decision)**: the FTS index covers meeting title, agenda, rough notes, note sections, decisions and action items. Transcript text is **not** indexed: it is encrypted at rest and an index would store it in plaintext. Search hits open the review page; "highlighted source context" is produced by decrypting the cited segment range (`source_from..source_to`) at request time and highlighting with escaping. Indexing transcripts would need a human decision about encrypting the index; it is out of this slice.
- `search_index` is derived and rebuildable from the tables above. A trigger deletes its rows the moment a meeting enters `deleting`, so hits vanish transactionally with the delete request.
- **Archive**: hidden from the default list (`status <> 'archived'`), still searchable only with "include archived"; reversible; nothing is deleted.
- **Retention**: raw audio is purged per chunk after that chunk is transcribed (default `raw_audio_retention_hours = 0`; the `retention` job purges leftovers after the configured hours, at most 7 days). Notes and transcripts are kept until the Owner deletes them unless `note_retention_days` is set (off by default).
- **Permanent deletion** (job `delete`, retryable, idempotent): the request transaction sets `meeting.status = 'deleting'`, appends the audit event and inserts the unique `delete:<meetingId>` job; from then on the meeting is a 404 on every surface. The job (1) deletes the object-store prefix `owner/<ownerId>/meeting/<meetingId>/`, (2) deletes `search_index` rows (already done by the trigger; re-run is a no-op), (3) in one transaction deletes the child rows by cascade (attendees, chunks, segments, note, sections, decisions, action items) and scrubs the `meeting` row into a tombstone (`status = 'deleted'`, `deleted_at`, content columns cleared) so a replay finds `deleted` and does nothing, (4) marks the job `succeeded`. `audit_event` and `job` rows remain and contain no content. Deleting is blocked from being undone by the transition table and by the CHECK that a `deleted` row is scrubbed.
- **Dependent rows** (`ON DELETE CASCADE` from `meeting`): `attendee`, `audio_chunk`, `transcript_segment`, `note` (-> sections, decisions, action items). `folder` and `template` are not meeting children (NO ACTION). `session`, `settings` and `provider_token` cascade from `owner`; `audit_event` references `owner` with NO ACTION (there is no owner-delete feature).

## 6. Transactions

| Operation | Single transaction covers |
|---|---|
| Create meeting | `meeting` + `attendee` rows + `idempotency_key` + `audit_event` |
| Confirm consent | `meeting.consent_*` + `audit_event` (repeat is a no-op) |
| Start / pause / resume | status change + `audit_event` (+ `capture_started_at`) |
| Stop capture | status -> `processing` + `capture_ended_at` + insert unique `job` (`transcribe:<id>`) + `audit_event` |
| Chunk upload | object put, then `audio_chunk` insert (unique seq); a replay with the same sha256 returns the first result |
| Transcribe one chunk | segments insert (unique per chunk and index) + chunk `state = 'transcribed'`; the raw object is purged afterwards and `purged_at` set |
| Save summary draft | `note`, sections, decisions, action items, FTS rows, `meeting.status -> review`, `audit_event` |
| Publish | `note.status/published_at/folder_id` + `meeting.status -> published` + `audit_event` |
| Speaker relabel | all affected `transcript_segment` rows |
| Request deletion | status -> `deleting` + FTS purge (trigger) + `job` + `audit_event` |
| Finish deletion | cascade deletes + tombstone scrub + `deleted` status + `audit_event` |

## 7. Idempotency

| Side effect | Key |
|---|---|
| Create meeting / publish / delete submissions | `idempotency_key (owner_id, scope, key)` from a hidden form token |
| Calendar import | partial unique `(owner_id, calendar_provider, provider_event_id)` |
| Webhook | `provider_event (provider, event_id)` |
| Chunk upload | `audio_chunk (meeting_id, seq)` |
| Transcription | `transcript_segment (meeting_id, chunk_seq, seg_index)` and `job.job_key` |
| Stop capture | `job.job_key = transcribe:<meetingId>` |
| Summary generation | `job.job_key = summarize:<meetingId>:<revision>` (regenerate-selection adds the section id) |
| Deletion | `job.job_key = delete:<meetingId>` plus the tombstone |

## 8. Seeds

`seeds/seed.ts` (`npm run db:seed`) inserts, for **owner A** (`ada@example.test`): a published meeting with transcript, note, decisions and action items in a folder; a brand-new `scheduled` meeting (empty: no notes or transcript); a `failed` meeting with one transcribed and one failed chunk; a note with an **overdue** open action item; an `archived` meeting; and a meeting in `deleting` with its pending job. For **owner B** (`ben@example.test`): a published meeting that A must never see, in B's own folder. All transcript text goes through the real cipher with a fixed development key (never a real secret). Seed passwords are added by #5.

## 9. Migrations and rollback guidance

Files: `migrations/NNNN_name.sql`, applied in order by `src/adapters/sqlite/migrate.ts` (local/CI) or `wrangler d1 migrations apply` (production). Forward-only: each applied file's checksum is recorded and a changed checksum aborts, so a merged migration cannot be edited. If two PRs add migrations, the later one renumbers on rebase.

| Migration | Contents | Rollback notes |
|---|---|---|
| `0001_init.sql` | All tables, indexes, triggers and the FTS table above | Pre-production only: drop the database (`rm` the SQLite file, or recreate the D1 database from a backup). There is no data to preserve before release. After release, never roll back `0001`; correct forward with a new migration. |

General rollback procedure for later migrations: (1) take a backup (`wrangler d1 export` / copy the SQLite file) before applying; (2) write the inverse as a **new** numbered migration (for example re-create the dropped column) rather than deleting the old file; (3) for a bad data migration restore from the backup taken in (1). Each future migration PR must add its row to this table with a concrete rollback note.

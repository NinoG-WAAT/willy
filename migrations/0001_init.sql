-- 0001_init: initial Willycrumbs schema (see docs/DATA_MODEL.md for the reasoning).
--
-- Conventions: TEXT ids from the injected IdGenerator; instants are UTC ISO-8601 with
-- milliseconds ('2026-10-27T09:00:00.000Z', enforced by GLOB checks so text order = time order);
-- every user-data table carries owner_id and child tables use composite foreign keys
-- (owner_id, parent_id) so the database refuses cross-owner links.
-- No PRAGMA/BEGIN/COMMIT here: the runner (or wrangler d1) wraps the file in a transaction and
-- foreign keys are enabled on every connection.
--
-- Rollback: pre-release only; drop the database and re-create it. After release correct forward
-- with a new migration (see docs/DATA_MODEL.md section 9).

-- ---------------------------------------------------------------- identity

CREATE TABLE owner (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE
                CHECK (email = lower(email) COLLATE BINARY AND length(email) BETWEEN 3 AND 254),
  display_name  TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 100),
  password_hash TEXT,
  created_at    TEXT NOT NULL
                CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z')
);

CREATE TABLE session (
  id                  TEXT PRIMARY KEY,
  owner_id            TEXT NOT NULL REFERENCES owner (id) ON DELETE CASCADE,
  token_hash          TEXT NOT NULL UNIQUE,
  csrf_secret         TEXT NOT NULL,
  created_at          TEXT NOT NULL
                      CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  last_seen_at        TEXT NOT NULL
                      CHECK (last_seen_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  idle_expires_at     TEXT NOT NULL
                      CHECK (idle_expires_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  absolute_expires_at TEXT NOT NULL
                      CHECK (absolute_expires_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  revoked_at          TEXT
                      CHECK (revoked_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  CHECK (idle_expires_at <= absolute_expires_at)
);
CREATE INDEX session_owner ON session (owner_id);

-- ---------------------------------------------------------------- folders and templates

CREATE TABLE folder (
  id         TEXT PRIMARY KEY,
  owner_id   TEXT NOT NULL REFERENCES owner (id),
  name       TEXT NOT NULL COLLATE NOCASE CHECK (length(name) BETWEEN 1 AND 100),
  created_at TEXT NOT NULL
             CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  updated_at TEXT NOT NULL
             CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  UNIQUE (owner_id, id),
  UNIQUE (owner_id, name)
);

CREATE TABLE template (
  id            TEXT PRIMARY KEY,
  owner_id      TEXT NOT NULL REFERENCES owner (id),
  name          TEXT NOT NULL COLLATE NOCASE CHECK (length(name) BETWEEN 1 AND 100),
  sections_json TEXT NOT NULL CHECK (json_valid(sections_json) AND json_type(sections_json) = 'array'),
  is_default    INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  created_at    TEXT NOT NULL
                CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  updated_at    TEXT NOT NULL
                CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  UNIQUE (owner_id, id),
  UNIQUE (owner_id, name)
);
CREATE UNIQUE INDEX template_one_default_per_owner ON template (owner_id) WHERE is_default = 1;

-- ---------------------------------------------------------------- meetings

CREATE TABLE meeting (
  id                        TEXT PRIMARY KEY,
  owner_id                  TEXT NOT NULL REFERENCES owner (id),
  status                    TEXT NOT NULL CHECK (status IN (
                              'scheduled', 'capturing', 'paused', 'processing', 'review',
                              'published', 'failed', 'archived', 'deleting', 'deleted')),
  status_before_archive     TEXT CHECK (status_before_archive IN ('scheduled', 'review', 'published', 'failed')),
  title                     TEXT NOT NULL CHECK (length(title) <= 200),
  agenda                    TEXT CHECK (length(agenda) <= 10000),
  rough_notes               TEXT CHECK (length(rough_notes) <= 200000),
  scheduled_start_at        TEXT NOT NULL
                            CHECK (scheduled_start_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  scheduled_end_at          TEXT
                            CHECK (scheduled_end_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  timezone                  TEXT NOT NULL CHECK (length(timezone) BETWEEN 1 AND 64),
  calendar_provider         TEXT CHECK (calendar_provider IN ('google', 'ics')),
  provider_event_id         TEXT CHECK (length(provider_event_id) BETWEEN 1 AND 1024),
  template_id               TEXT,
  consent_confirmed_at      TEXT
                            CHECK (consent_confirmed_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  consent_statement_version INTEGER CHECK (consent_statement_version >= 1),
  capture_started_at        TEXT
                            CHECK (capture_started_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  capture_ended_at          TEXT
                            CHECK (capture_ended_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  deleted_at                TEXT
                            CHECK (deleted_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  created_at                TEXT NOT NULL
                            CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  updated_at                TEXT NOT NULL
                            CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  UNIQUE (owner_id, id),
  FOREIGN KEY (owner_id, template_id) REFERENCES template (owner_id, id),
  CHECK (scheduled_end_at IS NULL OR scheduled_end_at >= scheduled_start_at),
  -- Consent invariant: no meeting can be in or past capture without a stored consent time.
  CHECK ((consent_confirmed_at IS NULL) = (consent_statement_version IS NULL)),
  CHECK (status NOT IN ('capturing', 'paused', 'processing', 'review', 'published', 'failed')
         OR consent_confirmed_at IS NOT NULL),
  CHECK ((status = 'archived') = (status_before_archive IS NOT NULL)),
  CHECK ((calendar_provider IS NULL) = (provider_event_id IS NULL)),
  -- A deleted meeting is a content-free tombstone (children are removed by the deletion job).
  CHECK ((status = 'deleted') = (title = '')),
  CHECK ((status = 'deleted') = (deleted_at IS NOT NULL)),
  CHECK (status <> 'deleted' OR (agenda IS NULL AND rough_notes IS NULL AND provider_event_id IS NULL))
);
CREATE INDEX meeting_owner_start ON meeting (owner_id, scheduled_start_at DESC);
CREATE INDEX meeting_owner_status ON meeting (owner_id, status);
-- Importing the same calendar event twice yields one Meeting (per owner).
CREATE UNIQUE INDEX meeting_owner_provider_event
  ON meeting (owner_id, calendar_provider, provider_event_id) WHERE provider_event_id IS NOT NULL;

CREATE TABLE attendee (
  id         TEXT PRIMARY KEY,
  owner_id   TEXT NOT NULL,
  meeting_id TEXT NOT NULL,
  name       TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  email      TEXT CHECK (email = lower(email) AND length(email) BETWEEN 3 AND 254),
  created_at TEXT NOT NULL
             CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  UNIQUE (owner_id, meeting_id, id),
  UNIQUE (meeting_id, email),
  FOREIGN KEY (owner_id, meeting_id) REFERENCES meeting (owner_id, id) ON DELETE CASCADE
);

CREATE TABLE audio_chunk (
  id                     TEXT PRIMARY KEY,
  owner_id               TEXT NOT NULL,
  meeting_id             TEXT NOT NULL,
  seq                    INTEGER NOT NULL CHECK (seq >= 0),
  state                  TEXT NOT NULL CHECK (state IN ('uploaded', 'transcribed', 'failed', 'purged')),
  byte_size              INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 1048576),
  duration_ms            INTEGER NOT NULL CHECK (duration_ms BETWEEN 1 AND 60000),
  content_type           TEXT NOT NULL CHECK (content_type IN
                           ('audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav')),
  sha256                 TEXT NOT NULL CHECK (length(sha256) = 64),
  key_id                 TEXT NOT NULL,
  object_key             TEXT UNIQUE,
  transcription_attempts INTEGER NOT NULL DEFAULT 0 CHECK (transcription_attempts >= 0),
  last_error_code        TEXT,
  created_at             TEXT NOT NULL
                         CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  transcribed_at         TEXT
                         CHECK (transcribed_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  purged_at              TEXT
                         CHECK (purged_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  -- Upload idempotency key: replaying a sequence number cannot create a second chunk.
  UNIQUE (meeting_id, seq),
  UNIQUE (owner_id, meeting_id, seq),
  -- The raw object exists exactly until the chunk is purged.
  CHECK ((state = 'purged') = (object_key IS NULL)),
  FOREIGN KEY (owner_id, meeting_id) REFERENCES meeting (owner_id, id) ON DELETE CASCADE
);

CREATE TABLE transcript_segment (
  id                     TEXT PRIMARY KEY,
  owner_id               TEXT NOT NULL,
  meeting_id             TEXT NOT NULL,
  chunk_seq              INTEGER NOT NULL,
  seg_index              INTEGER NOT NULL CHECK (seg_index BETWEEN 0 AND 9999),
  -- Orders the transcript; note sections, decisions and action items cite ranges of this value.
  position               INTEGER GENERATED ALWAYS AS (chunk_seq * 10000 + seg_index) STORED,
  start_ms               INTEGER NOT NULL CHECK (start_ms >= 0),
  end_ms                 INTEGER NOT NULL,
  speaker_label          TEXT NOT NULL CHECK (length(speaker_label) BETWEEN 1 AND 100),
  speaker_label_original TEXT NOT NULL CHECK (length(speaker_label_original) BETWEEN 1 AND 100),
  text_ciphertext        TEXT NOT NULL,
  text_key_id            TEXT NOT NULL,
  created_at             TEXT NOT NULL
                         CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  updated_at             TEXT NOT NULL
                         CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  CHECK (end_ms >= start_ms),
  -- Idempotent transcription: replaying a chunk cannot create duplicate segments.
  UNIQUE (meeting_id, chunk_seq, seg_index),
  FOREIGN KEY (owner_id, meeting_id, chunk_seq)
    REFERENCES audio_chunk (owner_id, meeting_id, seq) ON DELETE CASCADE
);
CREATE INDEX transcript_segment_order ON transcript_segment (meeting_id, position);

-- ---------------------------------------------------------------- notes (draft until published)

CREATE TABLE note (
  id           TEXT PRIMARY KEY,
  owner_id     TEXT NOT NULL,
  meeting_id   TEXT NOT NULL UNIQUE,
  status       TEXT NOT NULL CHECK (status IN ('draft', 'published')),
  revision     INTEGER NOT NULL CHECK (revision >= 1),
  folder_id    TEXT,
  generated_at TEXT
               CHECK (generated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  published_at TEXT
               CHECK (published_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  created_at   TEXT NOT NULL
               CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  updated_at   TEXT NOT NULL
               CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  UNIQUE (owner_id, id),
  UNIQUE (owner_id, meeting_id, id),
  -- Generated content stays a draft until a person publishes it into one of their folders.
  CHECK ((status = 'published') = (published_at IS NOT NULL)),
  CHECK (status <> 'published' OR folder_id IS NOT NULL),
  FOREIGN KEY (owner_id, meeting_id) REFERENCES meeting (owner_id, id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, folder_id) REFERENCES folder (owner_id, id)
);
CREATE INDEX note_owner_folder ON note (owner_id, folder_id);

CREATE TABLE note_section (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL,
  note_id     TEXT NOT NULL,
  position    INTEGER NOT NULL CHECK (position >= 0),
  heading     TEXT NOT NULL CHECK (length(heading) BETWEEN 1 AND 200),
  body        TEXT NOT NULL CHECK (length(body) <= 20000),
  source_from INTEGER,
  source_to   INTEGER,
  edited      INTEGER NOT NULL DEFAULT 0 CHECK (edited IN (0, 1)),
  created_at  TEXT NOT NULL
              CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  updated_at  TEXT NOT NULL
              CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  UNIQUE (note_id, position),
  CHECK ((source_from IS NULL) = (source_to IS NULL)),
  CHECK (source_from IS NULL OR (source_from >= 0 AND source_from <= source_to)),
  FOREIGN KEY (owner_id, note_id) REFERENCES note (owner_id, id) ON DELETE CASCADE
);

CREATE TABLE decision (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL,
  note_id     TEXT NOT NULL,
  position    INTEGER NOT NULL CHECK (position >= 0),
  text        TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 2000),
  source_from INTEGER,
  source_to   INTEGER,
  edited      INTEGER NOT NULL DEFAULT 0 CHECK (edited IN (0, 1)),
  created_at  TEXT NOT NULL
              CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  updated_at  TEXT NOT NULL
              CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  UNIQUE (note_id, position),
  CHECK ((source_from IS NULL) = (source_to IS NULL)),
  CHECK (source_from IS NULL OR (source_from >= 0 AND source_from <= source_to)),
  FOREIGN KEY (owner_id, note_id) REFERENCES note (owner_id, id) ON DELETE CASCADE
);

CREATE TABLE action_item (
  id                   TEXT PRIMARY KEY,
  owner_id             TEXT NOT NULL,
  meeting_id           TEXT NOT NULL,
  note_id              TEXT NOT NULL,
  position             INTEGER NOT NULL CHECK (position >= 0),
  text                 TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 2000),
  assignee_attendee_id TEXT,
  due_at               TEXT
                       CHECK (due_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  due_timezone         TEXT CHECK (length(due_timezone) BETWEEN 1 AND 64),
  status               TEXT NOT NULL CHECK (status IN ('open', 'done')),
  source_from          INTEGER,
  source_to            INTEGER,
  edited               INTEGER NOT NULL DEFAULT 0 CHECK (edited IN (0, 1)),
  created_at           TEXT NOT NULL
                       CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  updated_at           TEXT NOT NULL
                       CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  UNIQUE (note_id, position),
  CHECK ((due_at IS NULL) = (due_timezone IS NULL)),
  CHECK ((source_from IS NULL) = (source_to IS NULL)),
  CHECK (source_from IS NULL OR (source_from >= 0 AND source_from <= source_to)),
  FOREIGN KEY (owner_id, meeting_id, note_id)
    REFERENCES note (owner_id, meeting_id, id) ON DELETE CASCADE,
  -- Assignee must be an Attendee of the same meeting and owner (or null). NO ACTION so a meeting
  -- cascade can remove attendee and action item in one statement; use cases clear it first.
  FOREIGN KEY (owner_id, meeting_id, assignee_attendee_id)
    REFERENCES attendee (owner_id, meeting_id, id)
);
CREATE INDEX action_item_owner_due ON action_item (owner_id, status, due_at);
CREATE INDEX action_item_meeting ON action_item (owner_id, meeting_id);

-- ---------------------------------------------------------------- operations and integrity

CREATE TABLE job (
  id              TEXT PRIMARY KEY,
  owner_id        TEXT NOT NULL REFERENCES owner (id),
  meeting_id      TEXT,
  kind            TEXT NOT NULL CHECK (kind IN
                    ('transcribe', 'summarize', 'delete', 'retention', 'calendar_sync')),
  -- One job per logical side effect, e.g. 'transcribe:<meetingId>': stop twice, enqueue once.
  job_key         TEXT NOT NULL UNIQUE CHECK (length(job_key) BETWEEN 1 AND 200),
  status          TEXT NOT NULL CHECK (status IN ('pending', 'running', 'succeeded', 'retrying', 'failed')),
  attempts        INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts    INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts >= 1),
  next_run_at     TEXT
                  CHECK (next_run_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  last_error_code TEXT CHECK (length(last_error_code) <= 100),
  payload_json    TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
  created_at      TEXT NOT NULL
                  CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  updated_at      TEXT NOT NULL
                  CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  CHECK (attempts <= max_attempts),
  CHECK (status <> 'retrying' OR next_run_at IS NOT NULL),
  FOREIGN KEY (owner_id, meeting_id) REFERENCES meeting (owner_id, id)
);
CREATE INDEX job_runnable ON job (status, next_run_at);
CREATE INDEX job_meeting ON job (owner_id, meeting_id);

-- Append-only history. No FK to meeting on purpose: the record outlives permanent deletion and
-- holds only ids and states, never titles or text.
CREATE TABLE audit_event (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL REFERENCES owner (id),
  meeting_id  TEXT,
  kind        TEXT NOT NULL CHECK (length(kind) BETWEEN 1 AND 100),
  actor       TEXT NOT NULL CHECK (actor IN ('owner', 'system')),
  detail_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(detail_json)),
  occurred_at TEXT NOT NULL
              CHECK (occurred_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z')
);
CREATE INDEX audit_event_meeting ON audit_event (owner_id, meeting_id, occurred_at);

CREATE TRIGGER audit_event_no_update BEFORE UPDATE ON audit_event
BEGIN
  SELECT RAISE(ABORT, 'audit_event is append-only');
END;

CREATE TRIGGER audit_event_no_delete BEFORE DELETE ON audit_event
BEGIN
  SELECT RAISE(ABORT, 'audit_event is append-only');
END;

CREATE TABLE provider_event (
  id          TEXT PRIMARY KEY,
  provider    TEXT NOT NULL CHECK (length(provider) BETWEEN 1 AND 50),
  event_id    TEXT NOT NULL CHECK (length(event_id) BETWEEN 1 AND 1024),
  owner_id    TEXT REFERENCES owner (id),
  received_at TEXT NOT NULL
              CHECK (received_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  UNIQUE (provider, event_id)
);

CREATE TABLE idempotency_key (
  owner_id    TEXT NOT NULL REFERENCES owner (id),
  scope       TEXT NOT NULL CHECK (length(scope) BETWEEN 1 AND 100),
  key         TEXT NOT NULL CHECK (length(key) BETWEEN 1 AND 200),
  resource_id TEXT,
  created_at  TEXT NOT NULL
              CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  expires_at  TEXT NOT NULL
              CHECK (expires_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  PRIMARY KEY (owner_id, scope, key)
);

CREATE TABLE provider_token (
  id                 TEXT PRIMARY KEY,
  owner_id           TEXT NOT NULL REFERENCES owner (id),
  provider           TEXT NOT NULL CHECK (provider IN ('google')),
  access_ciphertext  TEXT NOT NULL,
  refresh_ciphertext TEXT,
  key_id             TEXT NOT NULL,
  expires_at         TEXT
                     CHECK (expires_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  created_at         TEXT NOT NULL
                     CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  updated_at         TEXT NOT NULL
                     CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  UNIQUE (owner_id, provider)
);

CREATE TABLE settings (
  owner_id                 TEXT PRIMARY KEY REFERENCES owner (id) ON DELETE CASCADE,
  -- 0 = delete raw audio right after successful transcription (default); max 7 days.
  raw_audio_retention_hours INTEGER NOT NULL DEFAULT 0 CHECK (raw_audio_retention_hours BETWEEN 0 AND 168),
  note_retention_days       INTEGER CHECK (note_retention_days >= 1),
  updated_at               TEXT NOT NULL
                           CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z')
);

-- ---------------------------------------------------------------- search (derived, rebuildable)

-- Indexes notes, not transcripts: transcript text is encrypted at rest. Always query with
-- `AND owner_id = ?`.
CREATE VIRTUAL TABLE search_index USING fts5(
  title,
  body,
  owner_id UNINDEXED,
  meeting_id UNINDEXED,
  kind UNINDEXED,
  ref_id UNINDEXED,
  tokenize = 'unicode61 remove_diacritics 2'
);

-- Hits vanish in the same transaction that requests deletion.
CREATE TRIGGER meeting_purge_search_on_deleting AFTER UPDATE OF status ON meeting
WHEN NEW.status IN ('deleting', 'deleted')
BEGIN
  DELETE FROM search_index WHERE meeting_id = NEW.id;
END;

CREATE TRIGGER meeting_purge_search_on_remove AFTER DELETE ON meeting
BEGIN
  DELETE FROM search_index WHERE meeting_id = OLD.id;
END;

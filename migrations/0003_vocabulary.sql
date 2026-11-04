-- 0003: the owner's vocabulary (issue #106): words their meetings use that a speech recogniser
-- does not know (project names, clients, acronyms). They prime speech-to-text.
--
-- Same conventions as 0001: TEXT id from the injected IdGenerator, UTC ISO-8601 instants with
-- milliseconds (GLOB check), owner_id on the row with UNIQUE (owner_id, id) so a future child
-- table can use a composite foreign key. The domain (src/domain/transcription/vocabulary.ts)
-- normalises a term before it is stored; these CHECKs are the backstop when something else
-- writes: 1..80 characters, already trimmed and single-spaced, no ASCII control character (the
-- GLOB class is built with char() because a migration file cannot hold raw control bytes), and
-- never a leading '-'. A term is unique per owner ignoring ASCII case (SQLite's NOCASE folds
-- nothing else, so the adapters also fold accented letters before they insert). At most 200 terms per
-- owner, enforced by a trigger so a concurrent writer cannot go over.
--
-- Rollback: nothing else references this table, so DROP TABLE vocabulary_term (its trigger and
-- indexes go with it) and delete the 0003 row of schema_migrations; the vocabulary is lost, and
-- the transcription job simply sends no terms. After release, prefer a new forward migration
-- (see docs/DATA_MODEL.md section 9).

CREATE TABLE vocabulary_term (
  id         TEXT PRIMARY KEY,
  owner_id   TEXT NOT NULL REFERENCES owner (id),
  term       TEXT NOT NULL
             CHECK (length(term) BETWEEN 1 AND 80
                    AND term = trim(term)
                    AND instr(term, '  ') = 0
                    AND substr(term, 1, 1) <> '-'
                    AND term NOT GLOB ('*[' || char(1) || '-' || char(31) || char(127) || ']*')),
  created_at TEXT NOT NULL
             CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  UNIQUE (owner_id, id),
  UNIQUE (owner_id, term COLLATE NOCASE)
);

CREATE TRIGGER vocabulary_term_limit BEFORE INSERT ON vocabulary_term
WHEN (SELECT COUNT(*) FROM vocabulary_term WHERE owner_id = NEW.owner_id) >= 200
BEGIN
  SELECT RAISE(ABORT, 'vocabulary_term_limit');
END;

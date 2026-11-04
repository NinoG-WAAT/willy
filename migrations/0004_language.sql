-- 0004: the owner's interface language (issue #114, French interface #113).
--
-- `settings.language` is the owner's choice of interface language: 'en' or 'fr'. NULL (the
-- default for every existing row, and for owners who have no settings row at all) means "not
-- chosen": the server's WILLY_DEFAULT_LOCALE applies. The CHECK is the backstop for the domain's
-- own validation (src/domain/settings/language.ts); adding a language later is a new migration
-- that rebuilds the table, so the list is deliberately short and explicit.
--
-- Rollback: ALTER TABLE settings DROP COLUMN language; and delete the 0004 row of
-- schema_migrations. Retention values are untouched; owners fall back to the server default
-- language. After release, prefer a new forward migration (see docs/DATA_MODEL.md section 9).

ALTER TABLE settings ADD COLUMN language TEXT CHECK (language IN ('en', 'fr'));

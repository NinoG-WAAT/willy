import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { join } from "node:path";
import { openDatabase } from "../../src/adapters/sqlite/database";
import { runMigrations } from "../../src/adapters/sqlite/migrate";

export type Row = Record<string, SQLInputValue>;

export const T0 = "2026-10-27T09:00:00.000Z";
export const T1 = "2026-10-27T10:00:00.000Z";

/** Fresh in-memory database with every migration applied. */
export function freshDb(): DatabaseSync {
  const db = openDatabase(":memory:");
  runMigrations(db, join(process.cwd(), "migrations"));
  return db;
}

/** Test-only helper: column names come from test code, values are always bound. */
export function insert(db: DatabaseSync, table: string, row: Row): void {
  const cols = Object.keys(row);
  const sql = `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`;
  db.prepare(sql).run(...Object.values(row));
}

export function owner(db: DatabaseSync, id: string, extra: Row = {}): void {
  insert(db, "owner", {
    id,
    email: `${id.toLowerCase()}@example.test`,
    display_name: id,
    created_at: T0,
    ...extra,
  });
}

export function folder(db: DatabaseSync, ownerId: string, id: string, extra: Row = {}): void {
  insert(db, "folder", {
    id,
    owner_id: ownerId,
    name: `Folder ${id}`,
    created_at: T0,
    updated_at: T0,
    ...extra,
  });
}

export function meeting(db: DatabaseSync, ownerId: string, id: string, extra: Row = {}): void {
  insert(db, "meeting", {
    id,
    owner_id: ownerId,
    status: "scheduled",
    title: `Meeting ${id}`,
    scheduled_start_at: T1,
    timezone: "Europe/Paris",
    created_at: T0,
    updated_at: T0,
    ...extra,
  });
}

export function consentedMeeting(
  db: DatabaseSync,
  ownerId: string,
  id: string,
  extra: Row = {},
): void {
  meeting(db, ownerId, id, {
    status: "capturing",
    consent_confirmed_at: T0,
    consent_statement_version: 1,
    capture_started_at: T0,
    ...extra,
  });
}

export function chunk(
  db: DatabaseSync,
  ownerId: string,
  meetingId: string,
  seq: number,
  extra: Row = {},
): void {
  insert(db, "audio_chunk", {
    id: `${meetingId}-c${String(seq)}`,
    owner_id: ownerId,
    meeting_id: meetingId,
    seq,
    state: "uploaded",
    byte_size: 1000,
    duration_ms: 10000,
    content_type: "audio/webm",
    sha256: "a".repeat(64),
    key_id: "dev",
    object_key: `owner/${ownerId}/meeting/${meetingId}/chunk-${String(seq)}`,
    created_at: T0,
    ...extra,
  });
}

export function segment(
  db: DatabaseSync,
  ownerId: string,
  meetingId: string,
  chunkSeq: number,
  segIndex: number,
  extra: Row = {},
): void {
  insert(db, "transcript_segment", {
    id: `${meetingId}-s${String(chunkSeq)}-${String(segIndex)}`,
    owner_id: ownerId,
    meeting_id: meetingId,
    chunk_seq: chunkSeq,
    seg_index: segIndex,
    start_ms: 0,
    end_ms: 1000,
    speaker_label: "Speaker 1",
    speaker_label_original: "Speaker 1",
    text_ciphertext: "v1.ciphertext",
    text_key_id: "dev",
    created_at: T0,
    updated_at: T0,
    ...extra,
  });
}

export function note(
  db: DatabaseSync,
  ownerId: string,
  meetingId: string,
  id: string,
  extra: Row = {},
): void {
  insert(db, "note", {
    id,
    owner_id: ownerId,
    meeting_id: meetingId,
    status: "draft",
    revision: 1,
    created_at: T0,
    updated_at: T0,
    generated_at: T0,
    ...extra,
  });
}

export function attendee(
  db: DatabaseSync,
  ownerId: string,
  meetingId: string,
  id: string,
  extra: Row = {},
): void {
  insert(db, "attendee", {
    id,
    owner_id: ownerId,
    meeting_id: meetingId,
    name: `Attendee ${id}`,
    created_at: T0,
    ...extra,
  });
}

export function count(db: DatabaseSync, table: string, where = "1 = 1"): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get();
  return Number(row?.["n"]);
}

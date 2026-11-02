import { copyFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../../../src/adapters/sqlite/database";
import { runMigrations } from "../../../src/adapters/sqlite/migrate";
import { chunk, consentedMeeting, owner, segment } from "../../support/db-fixtures";

const migrationsDir = join(process.cwd(), "migrations");
const FILE = "0002_meeting_relative_times.sql";

let dir: string;
let db: DatabaseSync;

/** [chunk_seq, seg_index, start_ms, end_ms] of a meeting, in transcript order. */
const times = (meetingId: string) =>
  db
    .prepare(
      "SELECT chunk_seq, seg_index, start_ms, end_ms FROM transcript_segment WHERE meeting_id = ? ORDER BY position",
    )
    .all(meetingId)
    .map((r) => [r["chunk_seq"], r["seg_index"], r["start_ms"], r["end_ms"]]);

/** Everything about the segments except the two columns the repair is allowed to change. */
const untouched = () =>
  db
    .prepare(
      `SELECT id, owner_id, meeting_id, chunk_seq, seg_index, position, speaker_label,
              speaker_label_original, text_ciphertext, text_key_id, created_at, updated_at
       FROM transcript_segment ORDER BY id`,
    )
    .all();

function seg(
  ownerId: string,
  meetingId: string,
  seq: number,
  index: number,
  startMs: number,
  endMs: number,
): void {
  segment(db, ownerId, meetingId, seq, index, { start_ms: startMs, end_ms: endMs });
}

beforeEach(() => {
  // A database as it is in the field: only 0001 applied, rows written with chunk-relative times.
  dir = mkdtempSync(join(tmpdir(), "willy-mig-0002-"));
  copyFileSync(join(migrationsDir, "0001_init.sql"), join(dir, "0001_init.sql"));
  db = openDatabase(":memory:");
  runMigrations(db, dir);
  owner(db, "A");
  owner(db, "B");

  // m1: the real-world shape. Chunk 2 failed and has no text, chunk 3 comes after it.
  consentedMeeting(db, "A", "m1");
  for (const [seq, durationMs] of [10_000, 8_000, 12_000, 10_000].entries()) {
    chunk(db, "A", "m1", seq, { duration_ms: durationMs });
  }
  seg("A", "m1", 0, 0, 0, 4_000);
  seg("A", "m1", 0, 1, 4_000, 8_000);
  seg("A", "m1", 1, 0, 0, 3_000);
  seg("A", "m1", 1, 1, 3_000, 6_000);
  seg("A", "m1", 3, 0, 500, 2_000);

  // m2: transcribed after the fix, so it already holds meeting times.
  consentedMeeting(db, "A", "m2");
  chunk(db, "A", "m2", 0);
  chunk(db, "A", "m2", 1);
  seg("A", "m2", 0, 0, 0, 4_000);
  seg("A", "m2", 1, 0, 10_000, 14_000);
  seg("A", "m2", 1, 1, 14_000, 18_000);

  // m3: a chunk retried after the fix (absolute) next to one stored before it (relative).
  consentedMeeting(db, "A", "m3");
  for (let seq = 0; seq < 3; seq++) chunk(db, "A", "m3", seq);
  seg("A", "m3", 0, 0, 0, 4_000);
  seg("A", "m3", 1, 0, 0, 4_000);
  seg("A", "m3", 2, 0, 20_000, 24_000);

  // m4: a sequence number that was never uploaded (no audio_chunk row) adds no time.
  consentedMeeting(db, "A", "m4");
  chunk(db, "A", "m4", 0);
  chunk(db, "A", "m4", 2);
  seg("A", "m4", 2, 0, 1_000, 2_000);

  // m5: another owner, same sequence numbers, other durations: must use its own chunks only.
  consentedMeeting(db, "B", "m5");
  chunk(db, "B", "m5", 0, { duration_ms: 3_000 });
  chunk(db, "B", "m5", 1, { duration_ms: 3_000 });
  seg("B", "m5", 0, 0, 0, 1_000);
  seg("B", "m5", 1, 0, 0, 1_000);
});

const applyRepair = () => {
  copyFileSync(join(migrationsDir, FILE), join(dir, FILE));
  return runMigrations(db, dir);
};

describe("0002_meeting_relative_times", () => {
  it("is applied by the runner and recorded", () => {
    expect(applyRepair().applied).toEqual(["0002_meeting_relative_times"]);
    expect(db.prepare("SELECT version FROM schema_migrations ORDER BY version").all()).toEqual([
      { version: "0001" },
      { version: "0002" },
    ]);
  });

  it("shifts chunk-relative rows by the audio of every earlier chunk, failed or empty ones included", () => {
    applyRepair();
    expect(times("m1")).toEqual([
      [0, 0, 0, 4_000],
      [0, 1, 4_000, 8_000],
      [1, 0, 10_000, 13_000],
      [1, 1, 13_000, 16_000],
      [3, 0, 30_500, 32_000],
    ]);
  });

  it("leaves rows that already hold meeting times alone", () => {
    applyRepair();
    expect(times("m2")).toEqual([
      [0, 0, 0, 4_000],
      [1, 0, 10_000, 14_000],
      [1, 1, 14_000, 18_000],
    ]);
  });

  it("repairs a mixed meeting chunk by chunk", () => {
    applyRepair();
    expect(times("m3")).toEqual([
      [0, 0, 0, 4_000],
      [1, 0, 10_000, 14_000],
      [2, 0, 20_000, 24_000],
    ]);
  });

  it("adds nothing for a sequence number that has no audio_chunk row", () => {
    applyRepair();
    expect(times("m4")).toEqual([[2, 0, 11_000, 12_000]]);
  });

  it("computes each meeting from its own chunks, never another owner's", () => {
    applyRepair();
    expect(times("m5")).toEqual([
      [0, 0, 0, 1_000],
      [1, 0, 3_000, 4_000],
    ]);
  });

  it("changes nothing but start_ms and end_ms", () => {
    const before = untouched();
    const chunksBefore = db.prepare("SELECT * FROM audio_chunk ORDER BY id").all();
    applyRepair();
    expect(untouched()).toEqual(before);
    expect(db.prepare("SELECT * FROM audio_chunk ORDER BY id").all()).toEqual(chunksBefore);
  });

  it("is safe to run again: the repaired rows are recognised and not shifted twice", () => {
    applyRepair();
    const ids = ["m1", "m2", "m3", "m4", "m5"];
    const once = ids.map(times);
    db.exec(readFileSync(join(migrationsDir, FILE), "utf8"));
    expect(ids.map(times)).toEqual(once);
  });

  it("leaves no helper table behind and still satisfies the segment constraints", () => {
    applyRepair();
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r) => String(r["name"]));
    expect(tables.filter((t) => t.includes("repair"))).toEqual([]);
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM transcript_segment WHERE end_ms < start_ms").get(),
    ).toEqual({ n: 0 });
  });
});

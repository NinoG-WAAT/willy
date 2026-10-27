import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { createEnvelopeCipher, parseKeyring } from "../../../src/adapters/crypto/envelope-cipher";
import { segmentTextContext } from "../../../src/domain/transcription/encryption-context";
import { DEV_KEYRING, seedDatabase, type SeedIds } from "../../../seeds/seed";
import { count, freshDb } from "../../support/db-fixtures";

const cipher = createEnvelopeCipher(parseKeyring(DEV_KEYRING.spec), DEV_KEYRING.activeKeyId);

let db: DatabaseSync;
let ids: SeedIds;

beforeEach(async () => {
  db = freshDb();
  ids = await seedDatabase(db, cipher);
});

function ownerOf(table: string, id: string): string | undefined {
  const row = db.prepare(`SELECT owner_id FROM ${table} WHERE id = ?`).get(id);
  return row ? String(row["owner_id"]) : undefined;
}

describe("seed data", () => {
  it("creates two distinct owners", () => {
    expect(ids.ownerA).not.toBe(ids.ownerB);
    expect(count(db, "owner")).toBe(2);
  });

  it("covers the happy path: published meeting with transcript, note, decision, action item", () => {
    const m = ids.meetings.published;
    expect(db.prepare("SELECT status FROM meeting WHERE id = ?").get(m)).toEqual({
      status: "published",
    });
    expect(count(db, "transcript_segment", `meeting_id = '${m}'`)).toBeGreaterThan(1);
    expect(db.prepare("SELECT status FROM note WHERE meeting_id = ?").get(m)).toEqual({
      status: "published",
    });
    expect(count(db, "decision")).toBeGreaterThan(0);
    expect(count(db, "action_item")).toBeGreaterThan(0);
    expect(count(db, "search_index", `meeting_id = '${m}'`)).toBeGreaterThan(0);
  });

  it("covers an empty meeting", () => {
    const m = ids.meetings.empty;
    expect(count(db, "attendee", `meeting_id = '${m}'`)).toBe(0);
    expect(count(db, "transcript_segment", `meeting_id = '${m}'`)).toBe(0);
    expect(count(db, "note", `meeting_id = '${m}'`)).toBe(0);
  });

  it("covers a failed transcription with a transcribed chunk and a failed chunk", () => {
    const m = ids.meetings.failed;
    expect(db.prepare("SELECT status FROM meeting WHERE id = ?").get(m)).toEqual({
      status: "failed",
    });
    const states = db
      .prepare("SELECT state FROM audio_chunk WHERE meeting_id = ? ORDER BY seq")
      .all(m)
      .map((r) => r["state"]);
    expect(states).toEqual(["transcribed", "failed"]);
    expect(db.prepare("SELECT status FROM job WHERE meeting_id = ?").get(m)).toEqual({
      status: "failed",
    });
    expect(
      db.prepare("SELECT rough_notes FROM meeting WHERE id = ?").get(m)?.["rough_notes"],
    ).toBeTruthy();
  });

  it("covers an overdue open action item", () => {
    const row = db
      .prepare(
        "SELECT COUNT(*) AS n FROM action_item WHERE owner_id = ? AND status = 'open' AND due_at < ?",
      )
      .get(ids.ownerA, ids.now);
    expect(Number(row?.["n"])).toBeGreaterThan(0);
  });

  it("covers archived and deleting meetings, the latter with a pending job and no search hits", () => {
    expect(
      db.prepare("SELECT status FROM meeting WHERE id = ?").get(ids.meetings.archived),
    ).toEqual({
      status: "archived",
    });
    const d = ids.meetings.deleting;
    expect(db.prepare("SELECT status FROM meeting WHERE id = ?").get(d)).toEqual({
      status: "deleting",
    });
    expect(db.prepare("SELECT kind, status FROM job WHERE meeting_id = ?").get(d)).toEqual({
      kind: "delete",
      status: "pending",
    });
    expect(count(db, "search_index", `meeting_id = '${d}'`)).toBe(0);
  });

  it("covers a meeting owned by the other owner", () => {
    expect(ownerOf("meeting", ids.meetings.otherOwner)).toBe(ids.ownerB);
  });

  it("stores transcript text encrypted and decryptable only with the right context", async () => {
    const rows = db
      .prepare("SELECT id, text_ciphertext, text_key_id FROM transcript_segment")
      .all();
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      const id = String(r["id"]);
      const ct = String(r["text_ciphertext"]);
      expect(r["text_key_id"]).toBe(DEV_KEYRING.activeKeyId);
      expect(ct.startsWith("v1.")).toBe(true);
      const plain = await cipher.decrypt(ct, segmentTextContext(id));
      expect(plain.length).toBeGreaterThan(0);
      expect(ct).not.toContain(plain);
      await expect(cipher.decrypt(ct, segmentTextContext("someone-else"))).rejects.toThrow();
    }
  });

  it("keeps every owner-bearing row consistent with its meeting's owner", () => {
    for (const table of [
      "attendee",
      "audio_chunk",
      "transcript_segment",
      "note",
      "action_item",
      "job",
    ]) {
      const bad = db
        .prepare(
          `SELECT COUNT(*) AS n FROM ${table} t JOIN meeting m ON m.id = t.meeting_id WHERE t.owner_id <> m.owner_id`,
        )
        .get();
      expect(Number(bad?.["n"]), table).toBe(0);
    }
  });
});

describe("owner scoping (cross-owner and guessed-id access)", () => {
  const tables = [
    "meeting",
    "attendee",
    "audio_chunk",
    "transcript_segment",
    "note",
    "action_item",
    "folder",
  ];

  it("owner A's scoped queries never return owner B's rows, and vice versa", () => {
    for (const table of tables) {
      const aRows = db.prepare(`SELECT id FROM ${table} WHERE owner_id = ?`).all(ids.ownerA);
      const bRows = db.prepare(`SELECT id FROM ${table} WHERE owner_id = ?`).all(ids.ownerB);
      const a = new Set(aRows.map((r) => r["id"]));
      expect(
        bRows.some((r) => a.has(r["id"])),
        table,
      ).toBe(false);
      expect(aRows.length + bRows.length, table).toBeGreaterThan(0);
    }
  });

  it("a guessed id of owner B's meeting finds nothing when scoped to owner A", () => {
    const guessed = ids.meetings.otherOwner;
    for (const table of ["attendee", "audio_chunk", "transcript_segment", "note", "action_item"]) {
      const hit = db
        .prepare(`SELECT id FROM ${table} WHERE owner_id = ? AND meeting_id = ?`)
        .get(ids.ownerA, guessed);
      expect(hit, table).toBeUndefined();
    }
    expect(
      db.prepare("SELECT id FROM meeting WHERE owner_id = ? AND id = ?").get(ids.ownerA, guessed),
    ).toBeUndefined();
  });

  it("search is owner scoped", () => {
    const hits = db
      .prepare(
        "SELECT DISTINCT meeting_id FROM search_index WHERE search_index MATCH ? AND owner_id = ?",
      )
      .all("roadmap", ids.ownerA)
      .map((r) => r["meeting_id"]);
    expect(hits).not.toContain(ids.meetings.otherOwner);
    const bHits = db
      .prepare(
        "SELECT DISTINCT meeting_id FROM search_index WHERE search_index MATCH ? AND owner_id = ?",
      )
      .all("roadmap", ids.ownerB)
      .map((r) => r["meeting_id"]);
    expect(bHits).toEqual([ids.meetings.otherOwner]);
  });
});

import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { DEV_KEYRING } from "../../../src/adapters/crypto/dev-keyring";
import { createEnvelopeCipher, parseKeyring } from "../../../src/adapters/crypto/envelope-cipher";
import { SqliteFolderRepository } from "../../../src/adapters/sqlite/folder-repository";
import { SqliteMeetingRepository } from "../../../src/adapters/sqlite/meeting-repository";
import { SqliteReviewRepository } from "../../../src/adapters/sqlite/review-repository";
import { FixedClock, SequentialIds } from "../../../src/adapters/system/fakes";
import { moveNoteToFolder } from "../../../src/app/notes/move-note";
import { publishNote, reopenNote, type ReviewDeps } from "../../../src/app/notes/review";
import { defined } from "../../support/assert";
import { consentedMeeting, count, folder, freshDb, owner } from "../../support/db-fixtures";
import { seedReviewMeeting } from "../../support/review-fixtures";

const cipher = createEnvelopeCipher(parseKeyring(DEV_KEYRING.spec), DEV_KEYRING.activeKeyId);
const NOW = "2026-10-27T10:00:00.000Z";

let db: DatabaseSync;
let deps: ReviewDeps;
let clock: FixedClock;

const row = (sql: string, ...params: string[]) => defined(db.prepare(sql).get(...params), "row");
const noteRow = (meetingId: string) =>
  row("SELECT status, folder_id, published_at, revision, updated_at FROM note WHERE meeting_id = ?", meetingId);
const moves = (meetingId: string) =>
  count(db, "audit_event", `meeting_id = '${meetingId}' AND kind = 'note.moved'`);

beforeEach(async () => {
  db = freshDb();
  clock = new FixedClock(new Date(NOW));
  const ids = new SequentialIds("id");
  deps = {
    reviews: new SqliteReviewRepository(db, ids),
    folders: new SqliteFolderRepository(db),
    meetings: new SqliteMeetingRepository(db, ids, clock),
    textCipher: cipher,
    clock,
  };
  owner(db, "A");
  owner(db, "B");
  folder(db, "A", "folder-A", { name: "Board" });
  folder(db, "A", "folder-A2", { name: "Customers" });
  folder(db, "B", "folder-B", { name: "Secret" });
  await seedReviewMeeting(db, "A", "pub", "published");
  await seedReviewMeeting(db, "A", "draft", "review");
  await seedReviewMeeting(db, "B", "pubB", "published");
});

describe("moveNoteToFolder", () => {
  it("moves a published note, keeps everything else, and writes exactly one audit event", async () => {
    clock.advance(22 * 3600_000);
    const before = noteRow("pub");
    const sections = row("SELECT COUNT(*) AS n, MAX(updated_at) AS u FROM note_section WHERE note_id = 'pub-note'");

    const result = await moveNoteToFolder(deps, "A", "pub", "folder-A2");

    expect(result).toEqual({ ok: true, value: { moved: true, folderName: "Customers" } });
    expect(noteRow("pub")).toEqual({
      ...before,
      folder_id: "folder-A2",
      updated_at: "2026-10-28T08:00:00.000Z",
    });
    expect(row("SELECT status FROM meeting WHERE id = 'pub'")["status"]).toBe("published");
    expect(
      row("SELECT COUNT(*) AS n, MAX(updated_at) AS u FROM note_section WHERE note_id = 'pub-note'"),
    ).toEqual(sections);
    expect(moves("pub")).toBe(1);
    expect(
      row("SELECT owner_id, actor, detail_json, occurred_at FROM audit_event WHERE kind = 'note.moved'"),
    ).toEqual({
      owner_id: "A",
      actor: "owner",
      detail_json: JSON.stringify({ fromFolderId: "folder-A", toFolderId: "folder-A2" }),
      occurred_at: "2026-10-28T08:00:00.000Z",
    });
  });

  it("is an idempotent no-op into the folder it is already in: no write, no second event", async () => {
    expect(await moveNoteToFolder(deps, "A", "pub", "folder-A2")).toMatchObject({ ok: true });
    const after = noteRow("pub");
    clock.advance(24 * 3600_000);
    const replay = await moveNoteToFolder(deps, "A", "pub", "folder-A2");
    expect(replay).toEqual({ ok: true, value: { moved: false, folderName: "Customers" } });
    expect(noteRow("pub")).toEqual(after);
    expect(moves("pub")).toBe(1);
    // Moving into the folder it was published into on day one is also an ordinary move.
    expect(await moveNoteToFolder(deps, "A", "pub", "folder-A")).toMatchObject({
      ok: true,
      value: { moved: true },
    });
    expect(moves("pub")).toBe(2);
  });

  it("refuses a draft, an archived, a reopened and a processing meeting and moves nothing", async () => {
    consentedMeeting(db, "A", "busy", { status: "processing" });
    await seedReviewMeeting(db, "A", "arch", "published");
    db.prepare(
      "UPDATE meeting SET status = 'archived', status_before_archive = 'published' WHERE id = 'arch'",
    ).run();
    await publishNote(deps, "A", "draft", { folderId: "folder-A", confirmed: true });
    await reopenNote(deps, "A", "draft");

    for (const [id, status] of [
      ["draft", "review"],
      ["arch", "archived"],
      ["busy", "processing"],
    ] as const) {
      expect(await moveNoteToFolder(deps, "A", id, "folder-A2")).toEqual({
        ok: false,
        error: { kind: "not_published", status },
      });
    }
    expect(row("SELECT folder_id FROM note WHERE meeting_id = 'draft'")["folder_id"]).toBe("folder-A");
    expect(row("SELECT folder_id FROM note WHERE meeting_id = 'arch'")["folder_id"]).toBe("folder-A");
    expect(count(db, "audit_event", "kind = 'note.moved'")).toBe(0);
  });

  it("treats a meeting being deleted as not found", async () => {
    consentedMeeting(db, "A", "gone", { status: "deleting" });
    expect(await moveNoteToFolder(deps, "A", "gone", "folder-A2")).toEqual({
      ok: false,
      error: { kind: "not_found" },
    });
  });

  it("owner A cannot move owner B's note, with B's ids, guessed ids, or into B's folder", async () => {
    expect(await moveNoteToFolder(deps, "A", "pubB", "folder-A2")).toEqual({
      ok: false,
      error: { kind: "not_found" },
    });
    expect(await moveNoteToFolder(deps, "A", "nope", "folder-A2")).toEqual({
      ok: false,
      error: { kind: "not_found" },
    });
    expect(await moveNoteToFolder(deps, "A", "pub", "folder-B")).toEqual({
      ok: false,
      error: { kind: "folder_not_found" },
    });
    expect(await moveNoteToFolder(deps, "A", "pub", "guess")).toEqual({
      ok: false,
      error: { kind: "folder_not_found" },
    });
    // B's own note and folder are untouched.
    expect(row("SELECT folder_id FROM note WHERE meeting_id = 'pubB'")["folder_id"]).toBe("folder-B");
    expect(row("SELECT folder_id FROM note WHERE meeting_id = 'pub'")["folder_id"]).toBe("folder-A");
    expect(count(db, "audit_event", "kind = 'note.moved'")).toBe(0);
  });

  it("rolls the move back when the audit event cannot be written", async () => {
    db.exec(
      `CREATE TRIGGER fail_move_audit BEFORE INSERT ON audit_event WHEN NEW.kind = 'note.moved'
       BEGIN SELECT RAISE(ABORT, 'audit down'); END`,
    );
    await expect(moveNoteToFolder(deps, "A", "pub", "folder-A2")).rejects.toThrow(/audit down/);
    expect(row("SELECT folder_id FROM note WHERE meeting_id = 'pub'")["folder_id"]).toBe("folder-A");
    expect(moves("pub")).toBe(0);
  });

  it("does not move a note that was reopened between the read and the write (concurrent change)", async () => {
    // Simulates the race at the repository level: the plan was made for a published note.
    const state = await deps.reviews.noteFolderState("A", "pub");
    await reopenNote(deps, "A", "pub");
    const applied = await deps.reviews.applyNoteMove(
      "A",
      "pub",
      { fromFolderId: "folder-A", toFolderId: "folder-A2" },
      clock.now(),
    );
    expect(state).toMatchObject({ meetingStatus: "published", noteStatus: "published" });
    expect(applied).toBe("conflict");
    expect(row("SELECT folder_id FROM note WHERE meeting_id = 'pub'")["folder_id"]).toBe("folder-A");
    expect(moves("pub")).toBe(0);
  });

  it("updates the folder counts: the old folder loses a published note, the new one gains it", async () => {
    const counts = async () =>
      Object.fromEntries(
        (await deps.folders.list("A")).map((f) => [f.id, [f.publishedCount, f.noteCount]]),
      );
    expect(await counts()).toEqual({ "folder-A": [1, 1], "folder-A2": [0, 0] });
    await moveNoteToFolder(deps, "A", "pub", "folder-A2");
    expect(await counts()).toEqual({ "folder-A": [0, 0], "folder-A2": [1, 1] });
  });

  it("lets the note be reopened and republished after a move, defaulting to the new folder", async () => {
    await moveNoteToFolder(deps, "A", "pub", "folder-A2");
    await reopenNote(deps, "A", "pub");
    expect(row("SELECT folder_id FROM note WHERE meeting_id = 'pub'")["folder_id"]).toBe("folder-A2");
  });
});

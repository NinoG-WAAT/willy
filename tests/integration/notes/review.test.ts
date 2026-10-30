import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { DEV_KEYRING } from "../../../src/adapters/crypto/dev-keyring";
import { createEnvelopeCipher, parseKeyring } from "../../../src/adapters/crypto/envelope-cipher";
import { SqliteFolderRepository } from "../../../src/adapters/sqlite/folder-repository";
import { SqliteMeetingRepository } from "../../../src/adapters/sqlite/meeting-repository";
import { SqliteNoteRepository } from "../../../src/adapters/sqlite/note-repository";
import { SqliteReviewRepository } from "../../../src/adapters/sqlite/review-repository";
import { FixedClock, SequentialIds } from "../../../src/adapters/system/fakes";
import {
  addActionItem,
  addDecision,
  deleteActionItem,
  deleteDecision,
  editActionItem,
  editDecision,
  editSection,
  loadReviewPage,
  publishNote,
  renameSpeaker,
  reopenNote,
  type ReviewDeps,
} from "../../../src/app/notes/review";
import { defined } from "../../support/assert";
import { seedReviewMeeting } from "../../support/review-fixtures";
import { consentedMeeting, count, folder, freshDb, owner } from "../../support/db-fixtures";

const cipher = createEnvelopeCipher(parseKeyring(DEV_KEYRING.spec), DEV_KEYRING.activeKeyId);

let db: DatabaseSync;
let deps: ReviewDeps;

const seedMeeting = (ownerId: string, id: string, status = "review") =>
  seedReviewMeeting(db, ownerId, id, status);

const row = (sql: string, ...params: string[]) => defined(db.prepare(sql).get(...params), "row");

beforeEach(async () => {
  db = freshDb();
  const clock = new FixedClock(new Date("2026-10-27T10:00:00.000Z"));
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
  folder(db, "B", "folder-B", { name: "Secret" });
  await seedMeeting("A", "m1");
  await seedMeeting("B", "m2");
});

describe("loadReviewPage", () => {
  it("shows the decrypted transcript in order next to the summary of a draft", async () => {
    const result = await loadReviewPage(deps, "A", "m1");
    if (!result.ok) throw new Error("expected a page");
    const page = result.value;
    expect(page.segments.map((s) => [s.position, s.speaker, s.text])).toEqual([
      [0, "Speaker 1", "Let's review the roadmap."],
      [1, "Speaker 2", "We ship in November."],
      [10000, "Speaker 1", "I will send the deck."],
    ]);
    expect(page.view.sections.map((s) => s.heading)).toEqual(["Summary", "Risks"]);
    expect(page.view.attendees.map((a) => a.name)).toEqual(["Ada Lovelace", "Grace Hopper"]);
    expect(page.folders.map((f) => f.name)).toEqual(["Board"]);
    expect(page.editable).toBe(true);
  });

  it("is read-only once published, and shows the folder", async () => {
    await seedMeeting("A", "m3", "published");
    const result = await loadReviewPage(deps, "A", "m3");
    if (!result.ok) throw new Error("expected a page");
    expect(result.value.editable).toBe(false);
    expect(result.value.view.note).toMatchObject({ status: "published", folderName: "Board" });
  });

  it("carries the template's name for the header, and none when the meeting has no template", async () => {
    db.prepare(
      `INSERT INTO template (id, owner_id, name, sections_json, created_at, updated_at)
       VALUES ('t1', 'A', 'Customer call', '[]', ?, ?)`,
    ).run("2026-10-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z");
    db.prepare("UPDATE meeting SET template_id = 't1' WHERE id = 'm1'").run();
    const withTemplate = await loadReviewPage(deps, "A", "m1");
    if (!withTemplate.ok) throw new Error("expected a page");
    expect(withTemplate.value.view.meeting.template).toEqual({ id: "t1", name: "Customer call" });
    const without = await loadReviewPage(deps, "B", "m2");
    if (!without.ok) throw new Error("expected a page");
    expect(without.value.view.meeting.template).toBeNull();
  });

  it("keeps the page usable when one segment cannot be decrypted", async () => {
    db.prepare("UPDATE transcript_segment SET text_ciphertext = 'garbage' WHERE id = ?").run(
      "m1-seg-0-1",
    );
    const result = await loadReviewPage(deps, "A", "m1");
    if (!result.ok) throw new Error("expected a page");
    expect(result.value.segments.map((s) => s.text)).toEqual([
      "Let's review the roadmap.",
      null,
      "I will send the deck.",
    ]);
  });

  it("is not ready before capture ends, and 404 for other owners, unknown and deleting meetings", async () => {
    consentedMeeting(db, "A", "live");
    expect(await loadReviewPage(deps, "A", "live")).toMatchObject({
      ok: false,
      error: { kind: "not_ready" },
    });
    consentedMeeting(db, "A", "gone", { status: "deleting" });
    for (const id of ["m2", "nope", "gone"]) {
      expect(await loadReviewPage(deps, "A", id)).toEqual({
        ok: false,
        error: { kind: "not_found" },
      });
    }
  });

  it("shows rough notes when there is no summary (failed processing)", async () => {
    consentedMeeting(db, "A", "failed", { status: "failed", rough_notes: "Customer wants SSO." });
    const result = await loadReviewPage(deps, "A", "failed");
    if (!result.ok) throw new Error("expected a page");
    expect(result.value.view.note).toBeNull();
    expect(result.value.view.meeting.roughNotes).toBe("Customer wants SSO.");
  });
});

describe("editSection", () => {
  it("saves the text, marks it edited, raises the revision and refreshes the search row", async () => {
    const result = await editSection(deps, "A", "m1", "m1-sec-0", "  We agreed   on the plan. ");
    expect(result.ok).toBe(true);
    expect(row("SELECT body, edited FROM note_section WHERE id = 'm1-sec-0'")).toMatchObject({
      body: "We agreed   on the plan.",
      edited: 1,
    });
    expect(row("SELECT revision FROM note WHERE id = 'm1-note'")["revision"]).toBe(2);
    expect(row("SELECT body FROM search_index WHERE ref_id = 'm1-sec-0'")["body"]).toBe(
      "We agreed   on the plan.",
    );
    // Other sections are untouched.
    expect(row("SELECT body, edited FROM note_section WHERE id = 'm1-sec-1'")).toMatchObject({
      body: "Pricing is pending.",
      edited: 0,
    });
  });

  it("makes a queued regeneration of the same revision stale, so it cannot overwrite the edit", async () => {
    await editSection(deps, "A", "m1", "m1-sec-0", "Mine.");
    const notes = new SqliteNoteRepository(db, new SequentialIds("n"));
    const outcome = await notes.replaceSection(
      "A",
      "m1",
      "m1-sec-0",
      1,
      { heading: "Summary", body: "Generated", sourceFrom: 0, sourceTo: 0 },
      new Date(),
    );
    expect(outcome).toBe("stale");
    expect(row("SELECT body FROM note_section WHERE id = 'm1-sec-0'")["body"]).toBe("Mine.");
  });

  it("reports validation problems as field errors and stores nothing", async () => {
    expect(await editSection(deps, "A", "m1", "m1-sec-0", "  ")).toMatchObject({
      ok: false,
      error: { kind: "invalid", errors: [{ field: "body" }] },
    });
    expect(row("SELECT edited FROM note_section WHERE id = 'm1-sec-0'")["edited"]).toBe(0);
  });

  it("owner A cannot edit owner B's section, with B's meeting id or with their own", async () => {
    expect(await editSection(deps, "A", "m2", "m2-sec-0", "Hacked")).toMatchObject({
      ok: false,
      error: { kind: "not_found" },
    });
    expect(await editSection(deps, "A", "m1", "m2-sec-0", "Hacked")).toMatchObject({
      ok: false,
      error: { kind: "not_found" },
    });
    expect(await editSection(deps, "A", "m1", "guess", "Hacked")).toMatchObject({
      ok: false,
      error: { kind: "not_found" },
    });
    expect(row("SELECT body FROM note_section WHERE id = 'm2-sec-0'")["body"]).toBe(
      "We reviewed the roadmap.",
    );
  });

  it("refuses edits to a published note", async () => {
    await seedMeeting("A", "m3", "published");
    expect(await editSection(deps, "A", "m3", "m3-sec-0", "Late edit")).toMatchObject({
      ok: false,
      error: { kind: "not_editable" },
    });
  });
});

describe("decisions", () => {
  it("adds, edits and deletes, keeping search rows in step", async () => {
    expect((await addDecision(deps, "A", "m1", " Hire   a designer ")).ok).toBe(true);
    const added = row("SELECT id, text, position, source_from FROM decision WHERE position = 1");
    expect(added).toMatchObject({ text: "Hire a designer", source_from: null });
    expect(count(db, "search_index", "kind = 'decision' AND meeting_id = 'm1'")).toBe(1);

    expect((await editDecision(deps, "A", "m1", "m1-dec-0", "Ship in December")).ok).toBe(true);
    expect(row("SELECT text, edited FROM decision WHERE id = 'm1-dec-0'")).toMatchObject({
      text: "Ship in December",
      edited: 1,
    });
    expect(row("SELECT body FROM search_index WHERE ref_id = 'm1-dec-0'")["body"]).toBe(
      "Ship in December",
    );

    expect((await deleteDecision(deps, "A", "m1", "m1-dec-0")).ok).toBe(true);
    expect(count(db, "decision", "note_id = 'm1-note'")).toBe(1);
    expect(count(db, "search_index", "ref_id = 'm1-dec-0'")).toBe(0);
  });

  it("owner A cannot add to, edit or delete owner B's decisions", async () => {
    for (const result of [
      await addDecision(deps, "A", "m2", "x"),
      await editDecision(deps, "A", "m2", "m2-dec-0", "x"),
      await editDecision(deps, "A", "m1", "m2-dec-0", "x"),
      await deleteDecision(deps, "A", "m2", "m2-dec-0"),
      await deleteDecision(deps, "A", "m1", "m2-dec-0"),
      await deleteDecision(deps, "A", "m1", "guess"),
    ]) {
      expect(result).toMatchObject({ ok: false, error: { kind: "not_found" } });
    }
    expect(count(db, "decision", "note_id = 'm2-note'")).toBe(1);
    expect(row("SELECT text FROM decision WHERE id = 'm2-dec-0'")["text"]).toBe("Ship in November");
  });
});

describe("action items", () => {
  const input = { text: "Send the deck", assignee: "m1-a2", due: "2026-11-05", done: false };

  it("edits text, owner (an attendee), due day in the meeting's zone and done", async () => {
    expect((await editActionItem(deps, "A", "m1", "m1-act-0", { ...input, done: true })).ok).toBe(
      true,
    );
    expect(
      row(
        "SELECT text, assignee_attendee_id AS who, due_at, due_timezone, status, edited FROM action_item WHERE id = 'm1-act-0'",
      ),
    ).toMatchObject({
      text: "Send the deck",
      who: "m1-a2",
      due_at: "2026-11-05T22:59:59.000Z",
      due_timezone: "Europe/Paris",
      status: "done",
      edited: 1,
    });
  });

  it("clears the owner and the due date", async () => {
    await editActionItem(deps, "A", "m1", "m1-act-0", { ...input, assignee: "", due: "" });
    expect(
      row(
        "SELECT assignee_attendee_id AS who, due_at, due_timezone FROM action_item WHERE id = 'm1-act-0'",
      ),
    ).toEqual({ who: null, due_at: null, due_timezone: null });
  });

  it("only accepts attendees of this meeting as owner", async () => {
    for (const assignee of ["m2-a1", "nobody"]) {
      expect(
        await editActionItem(deps, "A", "m1", "m1-act-0", { ...input, assignee }),
      ).toMatchObject({
        ok: false,
        error: { kind: "invalid", errors: [{ field: "assignee" }] },
      });
    }
    expect(
      row("SELECT assignee_attendee_id AS who FROM action_item WHERE id = 'm1-act-0'"),
    ).toEqual({
      who: "m1-a1",
    });
  });

  it("reports a bad date and adds and deletes items", async () => {
    expect(await addActionItem(deps, "A", "m1", { ...input, due: "2026-02-30" })).toMatchObject({
      ok: false,
      error: { kind: "invalid", errors: [{ field: "due" }] },
    });
    expect((await addActionItem(deps, "A", "m1", input)).ok).toBe(true);
    expect(count(db, "action_item", "note_id = 'm1-note'")).toBe(2);
    expect(count(db, "search_index", "kind = 'action_item' AND meeting_id = 'm1'")).toBe(1);
    expect((await deleteActionItem(deps, "A", "m1", "m1-act-0")).ok).toBe(true);
    expect(count(db, "action_item", "note_id = 'm1-note'")).toBe(1);
  });

  it("owner A cannot touch owner B's action items", async () => {
    for (const result of [
      await addActionItem(deps, "A", "m2", { ...input, assignee: "" }),
      await editActionItem(deps, "A", "m2", "m2-act-0", { ...input, assignee: "" }),
      await editActionItem(deps, "A", "m1", "m2-act-0", { ...input, assignee: "" }),
      await deleteActionItem(deps, "A", "m1", "m2-act-0"),
      await deleteActionItem(deps, "A", "m2", "m2-act-0"),
      await deleteActionItem(deps, "A", "m1", "guess"),
    ]) {
      expect(result).toMatchObject({ ok: false, error: { kind: "not_found" } });
    }
    expect(row("SELECT text FROM action_item WHERE id = 'm2-act-0'")["text"]).toBe("Send the deck");
  });
});

describe("renameSpeaker", () => {
  it("applies to every segment of the meeting with that label, and only this meeting", async () => {
    expect((await renameSpeaker(deps, "A", "m1", "Speaker 1", " Ada  Lovelace ")).ok).toBe(true);
    const labels = db
      .prepare(
        "SELECT meeting_id, speaker_label, speaker_label_original FROM transcript_segment ORDER BY meeting_id, position",
      )
      .all()
      .map((r) => [r["meeting_id"], r["speaker_label"], r["speaker_label_original"]]);
    expect(labels).toEqual([
      ["m1", "Ada Lovelace", "Speaker 1"],
      ["m1", "Speaker 2", "Speaker 2"],
      ["m1", "Ada Lovelace", "Speaker 1"],
      ["m2", "Speaker 1", "Speaker 1"],
      ["m2", "Speaker 2", "Speaker 2"],
      ["m2", "Speaker 1", "Speaker 1"],
    ]);
  });

  it("merges two speakers by renaming one to the other", async () => {
    await renameSpeaker(deps, "A", "m1", "Speaker 2", "Speaker 1");
    expect(
      count(db, "transcript_segment", "meeting_id = 'm1' AND speaker_label = 'Speaker 1'"),
    ).toBe(3);
  });

  it("rejects an unknown label, empty names, other owners and published notes", async () => {
    expect(await renameSpeaker(deps, "A", "m1", "Speaker 9", "X")).toMatchObject({
      ok: false,
      error: { kind: "invalid", errors: [{ field: "from" }] },
    });
    expect(await renameSpeaker(deps, "A", "m1", "Speaker 1", " ")).toMatchObject({
      ok: false,
      error: { kind: "invalid", errors: [{ field: "to" }] },
    });
    expect(await renameSpeaker(deps, "A", "m2", "Speaker 1", "X")).toMatchObject({
      ok: false,
      error: { kind: "not_found" },
    });
    await seedMeeting("A", "m3", "published");
    expect(await renameSpeaker(deps, "A", "m3", "Speaker 1", "X")).toMatchObject({
      ok: false,
      error: { kind: "not_editable" },
    });
    expect(count(db, "transcript_segment", "speaker_label = 'X'")).toBe(0);
  });
});

describe("publishNote", () => {
  const publish = (ownerId = "A", meetingId = "m1", folderId = "folder-A", confirmed = true) =>
    publishNote(deps, ownerId, meetingId, { folderId, confirmed });

  it("needs explicit confirmation and writes nothing without it", async () => {
    expect(await publish("A", "m1", "folder-A", false)).toMatchObject({
      ok: false,
      error: { kind: "invalid", errors: [{ field: "confirm" }] },
    });
    expect(row("SELECT status FROM note WHERE id = 'm1-note'")["status"]).toBe("draft");
    expect(row("SELECT status FROM meeting WHERE id = 'm1'")["status"]).toBe("review");
  });

  it("publishes the note into the owner's folder and records one audit event", async () => {
    expect((await publish()).ok).toBe(true);
    expect(row("SELECT status, folder_id, published_at FROM note WHERE id = 'm1-note'")).toEqual({
      status: "published",
      folder_id: "folder-A",
      published_at: "2026-10-27T10:00:00.000Z",
    });
    expect(row("SELECT status FROM meeting WHERE id = 'm1'")["status"]).toBe("published");
    expect(count(db, "audit_event", "meeting_id = 'm1' AND kind = 'meeting.published'")).toBe(1);
  });

  it("is idempotent: publishing again changes nothing and adds no event", async () => {
    await publish();
    (deps.clock as FixedClock).advance(60_000);
    expect((await publish()).ok).toBe(true);
    expect(row("SELECT published_at FROM note WHERE id = 'm1-note'")["published_at"]).toBe(
      "2026-10-27T10:00:00.000Z",
    );
    expect(count(db, "audit_event", "meeting_id = 'm1' AND kind = 'meeting.published'")).toBe(1);
  });

  it("refuses another owner's folder and unknown folders alike", async () => {
    for (const folderId of ["folder-B", "guess"]) {
      expect(await publish("A", "m1", folderId)).toMatchObject({
        ok: false,
        error: { kind: "invalid", errors: [{ field: "folder" }] },
      });
    }
    expect(row("SELECT status FROM note WHERE id = 'm1-note'")["status"]).toBe("draft");
  });

  it("owner A cannot publish owner B's meeting", async () => {
    expect(await publish("A", "m2", "folder-A")).toMatchObject({
      ok: false,
      error: { kind: "not_found" },
    });
    expect(row("SELECT status FROM note WHERE id = 'm2-note'")["status"]).toBe("draft");
  });

  it("cannot publish from any state but review", async () => {
    consentedMeeting(db, "A", "busy", { status: "processing" });
    expect(await publish("A", "busy")).toMatchObject({
      ok: false,
      error: { kind: "not_editable" },
    });
  });

  it("does not publish a meeting that has no note", async () => {
    consentedMeeting(db, "A", "nonote", { status: "review" });
    expect((await publish("A", "nonote")).ok).toBe(false);
    expect(row("SELECT status FROM meeting WHERE id = 'nonote'")["status"]).toBe("review");
  });
});

describe("reopenNote", () => {
  it("returns a published note to a draft that can be edited and republished", async () => {
    await publishNote(deps, "A", "m1", { folderId: "folder-A", confirmed: true });
    expect((await reopenNote(deps, "A", "m1")).ok).toBe(true);
    expect(row("SELECT status, published_at, folder_id FROM note WHERE id = 'm1-note'")).toEqual({
      status: "draft",
      published_at: null,
      folder_id: "folder-A",
    });
    expect(row("SELECT status FROM meeting WHERE id = 'm1'")["status"]).toBe("review");
    expect((await editSection(deps, "A", "m1", "m1-sec-0", "Edited again")).ok).toBe(true);
  });

  it("is a no-op on a draft and refuses other owners", async () => {
    expect((await reopenNote(deps, "A", "m1")).ok).toBe(true);
    expect(await reopenNote(deps, "A", "m2")).toMatchObject({
      ok: false,
      error: { kind: "not_found" },
    });
  });
});

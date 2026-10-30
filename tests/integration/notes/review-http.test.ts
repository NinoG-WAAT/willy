import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { DEV_KEYRING } from "../../../src/adapters/crypto/dev-keyring";
import { createEnvelopeCipher, parseKeyring } from "../../../src/adapters/crypto/envelope-cipher";
import { SqliteFolderRepository } from "../../../src/adapters/sqlite/folder-repository";
import { SqliteMeetingRepository } from "../../../src/adapters/sqlite/meeting-repository";
import { SqliteReviewRepository } from "../../../src/adapters/sqlite/review-repository";
import { FixedClock, SequentialIds } from "../../../src/adapters/system/fakes";
import {
  handleReviewForm,
  reviewNoticeText,
  type ReviewFormDeps,
  type ReviewFormResult,
} from "../../../src/app/notes/review-http";
import { count, consentedMeeting, folder, freshDb, owner } from "../../support/db-fixtures";
import { seedReviewMeeting } from "../../support/review-fixtures";

const cipher = createEnvelopeCipher(parseKeyring(DEV_KEYRING.spec), DEV_KEYRING.activeKeyId);

let db: DatabaseSync;
let deps: ReviewFormDeps;

const form = (fields: Record<string, string>): FormData => {
  const data = new FormData();
  data.set("csrf_token", "token");
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};

const submit = (ownerId: string, meetingId: string, fields: Record<string, string>) =>
  handleReviewForm(deps, ownerId, meetingId, form(fields));

beforeEach(async () => {
  db = freshDb();
  const clock = new FixedClock(new Date("2026-10-27T10:00:00.000Z"));
  const ids = new SequentialIds("id");
  const meetings = new SqliteMeetingRepository(db, ids, clock);
  deps = {
    review: {
      reviews: new SqliteReviewRepository(db, ids),
      folders: new SqliteFolderRepository(db),
      meetings,
      textCipher: cipher,
      clock,
    },
    capture: { meetings, clock },
  };
  owner(db, "A");
  owner(db, "B");
  folder(db, "A", "folder-A", { name: "Board" });
  folder(db, "A", "folder-A2", { name: "Customers" });
  folder(db, "B", "folder-B", { name: "Secret" });
  await seedReviewMeeting(db, "A", "m1");
  await seedReviewMeeting(db, "B", "m2");
});

function expectRedirect(result: ReviewFormResult, notice: string, anchor: string | null) {
  expect(result).toEqual({ kind: "redirect", notice, anchor });
}

describe("handleReviewForm", () => {
  it("saves a section and sends the owner back to it with a fixed notice", async () => {
    expectRedirect(
      await submit("A", "m1", { intent: "edit_section", id: "m1-sec-0", body: "New text" }),
      "section_saved",
      "section-m1-sec-0",
    );
    expect(reviewNoticeText("section_saved")).toBe("Section saved.");
    expect(reviewNoticeText("<script>")).toBeNull();
  });

  it("edits a decision and an action item, and adds and removes them", async () => {
    expectRedirect(
      await submit("A", "m1", { intent: "edit_decision", id: "m1-dec-0", text: "Ship in Dec" }),
      "decision_saved",
      "decision-m1-dec-0",
    );
    expectRedirect(
      await submit("A", "m1", { intent: "add_decision", text: "Hire" }),
      "decision_added",
      "decisions",
    );
    expectRedirect(
      await submit("A", "m1", {
        intent: "edit_action_item",
        id: "m1-act-0",
        text: "Send the deck",
        assignee: "m1-a2",
        due: "2026-11-05",
        done: "on",
      }),
      "action_saved",
      "action-m1-act-0",
    );
    expectRedirect(
      await submit("A", "m1", { intent: "delete_action_item", id: "m1-act-0" }),
      "action_removed",
      "action-items",
    );
    expect(count(db, "action_item", "note_id = 'm1-note'")).toBe(0);
  });

  it("renames and merges speakers", async () => {
    expectRedirect(
      await submit("A", "m1", { intent: "rename_speaker", from: "Speaker 1", to: "Ada" }),
      "speaker_renamed",
      "speakers",
    );
    expectRedirect(
      await submit("A", "m1", { intent: "merge_speaker", from: "Speaker 2", to: "Ada" }),
      "speakers_merged",
      "speakers",
    );
    expect(count(db, "transcript_segment", "meeting_id = 'm1' AND speaker_label = 'Ada'")).toBe(3);
  });

  it("publishes only with the confirmation, and a repeat is a harmless success", async () => {
    const unconfirmed = await submit("A", "m1", { intent: "publish", folder: "folder-A" });
    expect(unconfirmed).toMatchObject({ kind: "problem", status: 422 });
    const fields = { intent: "publish", folder: "folder-A", confirm: "on" };
    expectRedirect(await submit("A", "m1", fields), "published", "publish");
    expectRedirect(await submit("A", "m1", fields), "published", "publish");
    expect(count(db, "audit_event", "kind = 'meeting.published'")).toBe(1);
    expectRedirect(await submit("A", "m1", { intent: "reopen" }), "reopened", "publish");
  });

  it("moves a published note: a fixed notice, a repeat is told so, and no second audit event", async () => {
    await seedReviewMeeting(db, "A", "pub", "published");
    expectRedirect(
      await submit("A", "pub", { intent: "move_note", folder: "folder-A2" }),
      "moved",
      "move-folder",
    );
    expectRedirect(
      await submit("A", "pub", { intent: "move_note", folder: "folder-A2" }),
      "move_unchanged",
      "move-folder",
    );
    expect(count(db, "audit_event", "kind = 'note.moved'")).toBe(1);
    expect(reviewNoticeText("moved")).toBe("Moved.");
    expect(reviewNoticeText("move_unchanged")).toBe("Already in that folder.");
  });

  it("shows a folder that is gone, foreign or missing as a 422 on the folder field, and moves nothing", async () => {
    await seedReviewMeeting(db, "A", "pub", "published");
    for (const folderId of ["folder-B", "guess", ""]) {
      expect(await submit("A", "pub", { intent: "move_note", folder: folderId })).toMatchObject({
        kind: "problem",
        status: 422,
        errors: [{ field: "folder" }],
        echo: { itemId: "move_note" },
      });
    }
    expect(count(db, "audit_event", "kind = 'note.moved'")).toBe(0);
  });

  it("answers 409 when the note is not published, and never moves it", async () => {
    expect(await submit("A", "m1", { intent: "move_note", folder: "folder-A2" })).toMatchObject({
      kind: "problem",
      status: 409,
    });
    expect(count(db, "audit_event", "kind = 'note.moved'")).toBe(0);
  });

  it("reports a validation problem with 422 and echoes what was typed, without saving", async () => {
    const result = await submit("A", "m1", {
      intent: "edit_action_item",
      id: "m1-act-0",
      text: "  ",
      assignee: "m1-a2",
      due: "2026-11-05",
    });
    expect(result).toMatchObject({
      kind: "problem",
      status: 422,
      errors: [{ field: "text" }],
      echo: { itemId: "m1-act-0", values: { assignee: "m1-a2", due: "2026-11-05" } },
    });
  });

  it("answers 409 for an edit to a note that is no longer a draft", async () => {
    await submit("A", "m1", { intent: "publish", folder: "folder-A", confirm: "on" });
    expect(
      await submit("A", "m1", { intent: "edit_section", id: "m1-sec-0", body: "Late" }),
    ).toMatchObject({ kind: "problem", status: 409 });
  });

  it("restarts transcription of a failed meeting once; a double click is harmless", async () => {
    consentedMeeting(db, "A", "failed", { status: "failed" });
    expectRedirect(
      await submit("A", "failed", { intent: "retry_transcription" }),
      "retry_queued",
      null,
    );
    expectRedirect(
      await submit("A", "failed", { intent: "retry_transcription" }),
      "retry_queued",
      null,
    );
    expect(count(db, "job", "meeting_id = 'failed' AND kind = 'transcribe'")).toBe(1);
    // A meeting that is not failed cannot be retried.
    expect(await submit("A", "m1", { intent: "retry_transcription" })).toMatchObject({
      kind: "problem",
      status: 409,
    });
  });

  it("treats other owners' meetings and items exactly like unknown ones", async () => {
    const attempts: Record<string, string>[] = [
      { intent: "edit_section", id: "m2-sec-0", body: "x" },
      { intent: "edit_decision", id: "m2-dec-0", text: "x" },
      { intent: "delete_decision", id: "m2-dec-0" },
      { intent: "edit_action_item", id: "m2-act-0", text: "x" },
      { intent: "delete_action_item", id: "m2-act-0" },
      { intent: "rename_speaker", from: "Speaker 1", to: "x" },
      { intent: "publish", folder: "folder-A", confirm: "on" },
      { intent: "reopen" },
      { intent: "retry_transcription" },
      { intent: "move_note", folder: "folder-A2" },
    ];
    for (const fields of attempts) {
      expect(await submit("A", "m2", fields)).toEqual({ kind: "not_found" });
      expect(await submit("A", "unknown", fields)).toEqual({ kind: "not_found" });
    }
    expect(await submit("A", "m1", { intent: "edit_section", id: "m2-sec-0", body: "x" })).toEqual({
      kind: "not_found",
    });
    expect(count(db, "decision", "text = 'x'") + count(db, "action_item", "text = 'x'")).toBe(0);
  });

  it("rejects unknown intents, unknown fields, malformed ids and repeated fields", async () => {
    for (const fields of [
      { intent: "drop_table" },
      { intent: "edit_section", id: "m1-sec-0", body: "x", owner_id: "B" },
      { intent: "edit_section", id: "../etc", body: "x" },
      {},
    ]) {
      expect(await submit("A", "m1", fields)).toEqual({ kind: "bad_request" });
    }
    const twice = form({ intent: "reopen" });
    twice.append("intent", "publish");
    expect(await handleReviewForm(deps, "A", "m1", twice)).toEqual({ kind: "bad_request" });
  });
});

import { describe, expect, it } from "vitest";
import { planNoteMove, type MovableNote } from "../../../src/domain/notes/move";

const published: MovableNote = {
  ownerId: "A",
  meetingStatus: "published",
  noteStatus: "published",
  folderId: "f1",
};
const mine = { id: "f2", ownerId: "A" };

describe("planNoteMove", () => {
  it("moves a published note to another folder of the same owner, with one content-free audit event", () => {
    expect(planNoteMove(published, mine)).toEqual({
      ok: true,
      value: {
        changed: true,
        fromFolderId: "f1",
        toFolderId: "f2",
        event: {
          kind: "note.moved",
          actor: "owner",
          detail: { fromFolderId: "f1", toFolderId: "f2" },
        },
      },
    });
  });

  it("treats moving into the folder it is already in as a no-op: no change, no event", () => {
    expect(planNoteMove(published, { id: "f1", ownerId: "A" })).toEqual({
      ok: true,
      value: { changed: false },
    });
  });

  it.each([
    "review",
    "archived",
    "processing",
    "failed",
    "deleting",
    "deleted",
    "scheduled",
  ] as const)("refuses a meeting that is %s", (meetingStatus) => {
    expect(planNoteMove({ ...published, meetingStatus }, mine)).toEqual({
      ok: false,
      error: { kind: "not_published", status: meetingStatus },
    });
  });

  it("refuses a published meeting whose note is a draft or missing", () => {
    for (const noteStatus of ["draft", null] as const) {
      expect(planNoteMove({ ...published, noteStatus }, mine)).toMatchObject({
        ok: false,
        error: { kind: "not_published" },
      });
    }
  });

  it("refuses another owner's folder and a missing one with the same error", () => {
    const expected = { ok: false, error: { kind: "folder_not_found" } };
    expect(planNoteMove(published, { id: "fb", ownerId: "B" })).toEqual(expected);
    expect(planNoteMove(published, null)).toEqual(expected);
  });

  it("checks the status before the folder, so a draft never learns anything about folders", () => {
    expect(planNoteMove({ ...published, meetingStatus: "review" }, null)).toMatchObject({
      ok: false,
      error: { kind: "not_published" },
    });
  });
});

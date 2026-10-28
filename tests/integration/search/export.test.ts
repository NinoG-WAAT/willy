import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { SqliteNoteReader } from "../../../src/adapters/sqlite/note-reader";
import { exportMeetingMarkdown, type ExportDeps } from "../../../src/app/search/export";
import {
  T0,
  attendee,
  folder,
  freshDb,
  insert,
  meeting,
  note,
  owner,
} from "../../support/db-fixtures";

let db: DatabaseSync;
let deps: ExportDeps;

beforeEach(() => {
  db = freshDb();
  deps = { reader: new SqliteNoteReader(db) };
  owner(db, "A");
  owner(db, "B");
});

function publishedMeeting(ownerId: string, id: string) {
  folder(db, ownerId, `f-${id}`, { name: "Board updates" });
  meeting(db, ownerId, id, {
    title: "Weekly sync",
    status: "published",
    agenda: "Roadmap",
    rough_notes: "ship beta",
    consent_confirmed_at: T0,
    consent_statement_version: 1,
    scheduled_start_at: "2026-11-03T08:00:00.000Z",
    timezone: "Europe/Paris",
  });
  attendee(db, ownerId, id, `${id}-a1`, { name: "Ada Founder", email: "ada@example.test" });
  attendee(db, ownerId, id, `${id}-a2`, { name: "Grace Hopper", email: "grace@example.test" });
  note(db, ownerId, id, `${id}-n`, { status: "published", published_at: T0, folder_id: `f-${id}` });
  insert(db, "note_section", {
    id: `${id}-s1`,
    owner_id: ownerId,
    note_id: `${id}-n`,
    position: 1,
    heading: "Risks",
    body: "Pricing pending.",
    created_at: T0,
    updated_at: T0,
  });
  insert(db, "note_section", {
    id: `${id}-s0`,
    owner_id: ownerId,
    note_id: `${id}-n`,
    position: 0,
    heading: "Summary",
    body: "Agreed on November.",
    created_at: T0,
    updated_at: T0,
  });
  insert(db, "decision", {
    id: `${id}-d0`,
    owner_id: ownerId,
    note_id: `${id}-n`,
    position: 0,
    text: "Ship in November.",
    created_at: T0,
    updated_at: T0,
  });
  insert(db, "action_item", {
    id: `${id}-ai0`,
    owner_id: ownerId,
    meeting_id: id,
    note_id: `${id}-n`,
    position: 0,
    text: "Send the deck",
    assignee_attendee_id: `${id}-a1`,
    due_at: "2026-11-07T22:59:59.999Z",
    due_timezone: "Europe/Paris",
    status: "open",
    created_at: T0,
    updated_at: T0,
  });
}

describe("exportMeetingMarkdown", () => {
  it("exports the whole note in reading order with owners and due dates, and a safe filename", async () => {
    publishedMeeting("A", "m1");
    const result = await exportMeetingMarkdown(deps, "A", "m1");
    expect(result).toMatchObject({ ok: true, value: { filename: "weekly-sync-2026-11-03.md" } });
    const md = result.ok ? result.value.markdown : "";
    expect(md).toContain("# Weekly sync");
    expect(md).toContain("- **Folder:** Board updates");
    expect(md).toContain("- **Attendees:** Ada Founder, Grace Hopper");
    expect(md.indexOf("### Summary")).toBeLessThan(md.indexOf("### Risks"));
    expect(md).toContain("- Ship in November.");
    expect(md).toContain("- [ ] Send the deck (owner: Ada Founder, due 2026-11-07)");
    expect(md).not.toContain("@example.test");
  });

  it("exports a meeting that has no note yet (agenda and rough notes only)", async () => {
    meeting(db, "A", "m2", { title: "Not started", agenda: "Plan", rough_notes: "pre-notes" });
    const result = await exportMeetingMarkdown(deps, "A", "m2");
    const md = result.ok ? result.value.markdown : "";
    expect(md).toContain("## Agenda\n\nPlan");
    expect(md).toContain("## Rough notes\n\npre-notes");
    expect(md).not.toContain("## Decisions");
  });

  it("is not_found for another owner's meeting, a guessed id and a meeting being deleted", async () => {
    publishedMeeting("B", "mb");
    meeting(db, "A", "gone", { status: "deleting", title: "Gone" });
    for (const id of ["mb", "nope", "gone"]) {
      expect(await exportMeetingMarkdown(deps, "A", id)).toEqual({
        ok: false,
        error: { kind: "not_found" },
      });
    }
  });

  it("exports only the requested owner's data even if ids collide in shape", async () => {
    publishedMeeting("A", "ma");
    publishedMeeting("B", "mb");
    db.prepare("UPDATE decision SET text = 'Ben only' WHERE owner_id = 'B'").run();
    const mine = await exportMeetingMarkdown(deps, "A", "ma");
    expect(mine.ok && mine.value.markdown).not.toContain("Ben only");
  });
});

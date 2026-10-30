import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { SqliteFolderRepository } from "../../../src/adapters/sqlite/folder-repository";
import { SqliteNoteLists } from "../../../src/adapters/sqlite/note-lists";
import { FixedClock } from "../../../src/adapters/system/fakes";
import { loadAllNotes, type AllNotesDeps } from "../../../src/app/notes/all-notes";
import { loadInbox, type InboxDeps } from "../../../src/app/meetings/inbox";
import { INBOX_SECTION_LIMIT } from "../../../src/domain/meetings/inbox";
import { FOLDER_PAGE_SIZE } from "../../../src/domain/notes/folder-view";
import type { NotesFilterInput } from "../../../src/domain/notes/notes-filter";
import {
  attendee,
  consentedMeeting,
  folder,
  freshDb,
  meeting,
  note,
  owner,
  T0,
} from "../../support/db-fixtures";

const NOW = new Date("2026-11-03T10:00:00.000Z");

let db: DatabaseSync;
let inboxDeps: InboxDeps;
let allDeps: AllNotesDeps;

beforeEach(() => {
  db = freshDb();
  owner(db, "A");
  owner(db, "B");
  const lists = new SqliteNoteLists(db);
  const folders = new SqliteFolderRepository(db);
  inboxDeps = { inbox: lists, folders, clock: new FixedClock(NOW) };
  allDeps = { notes: lists, folders };
});

type Extra = Record<string, string>;

/** A meeting at `start` (an ISO instant) with one hour assumed unless `end` says otherwise. */
function m(
  ownerId: string,
  id: string,
  status: string,
  start: string,
  extra: Extra = {},
): void {
  const base: Extra = { title: `Title ${id}`, scheduled_start_at: start, ...extra };
  if (status === "scheduled") meeting(db, ownerId, id, { ...base, status });
  else if (status === "archived")
    consentedMeeting(db, ownerId, id, { ...base, status, status_before_archive: "published" });
  else if (status === "deleted")
    consentedMeeting(db, ownerId, id, { ...base, status, title: "", deleted_at: T0 });
  else consentedMeeting(db, ownerId, id, { ...base, status });
}

const inbox = (ownerId = "A") => loadInbox(inboxDeps, ownerId);
const ids = (items: readonly { id: string }[]): string[] => items.map((i) => i.id);
const all = (input: Partial<NotesFilterInput> = {}, ownerId = "A") =>
  loadAllNotes(allDeps, ownerId, { status: "all", folderId: null, page: null, ...input });

describe("loadInbox", () => {
  it("puts each status in its place: scheduled upcoming, running work, drafts; published and archived never", async () => {
    m("A", "soon", "scheduled", "2026-11-04T09:00:00.000Z", {
      scheduled_end_at: "2026-11-04T09:30:00.000Z",
    });
    m("A", "capturing", "capturing", "2026-11-03T09:00:00.000Z");
    m("A", "paused", "paused", "2026-11-03T08:00:00.000Z");
    m("A", "processing", "processing", "2026-11-02T09:00:00.000Z");
    m("A", "failed", "failed", "2026-11-01T09:00:00.000Z");
    m("A", "draft", "review", "2026-11-02T15:00:00.000Z");
    m("A", "pub", "published", "2026-10-01T09:00:00.000Z");
    m("A", "arch", "archived", "2026-10-02T09:00:00.000Z");
    const { sections } = await inbox();
    expect(ids(sections.upcoming.items)).toEqual(["soon"]);
    expect(ids(sections.inProgress.items)).toEqual(["capturing", "paused", "processing", "failed"]);
    expect(ids(sections.drafts.items)).toEqual(["draft"]);
    expect(sections.missed.items).toEqual([]);
  });

  it("orders upcoming soonest first and the other sections newest first", async () => {
    m("A", "later", "scheduled", "2026-11-09T09:00:00.000Z", {
      scheduled_end_at: "2026-11-09T10:00:00.000Z",
    });
    m("A", "sooner", "scheduled", "2026-11-04T09:00:00.000Z", {
      scheduled_end_at: "2026-11-04T10:00:00.000Z",
    });
    m("A", "d-old", "review", "2026-10-01T09:00:00.000Z");
    m("A", "d-new", "review", "2026-10-20T09:00:00.000Z");
    m("A", "p-old", "processing", "2026-10-01T09:00:00.000Z");
    m("A", "p-new", "capturing", "2026-10-20T09:00:00.000Z");
    const { sections } = await inbox();
    expect(ids(sections.upcoming.items)).toEqual(["sooner", "later"]);
    expect(ids(sections.drafts.items)).toEqual(["d-new", "d-old"]);
    expect(ids(sections.inProgress.items)).toEqual(["p-new", "p-old"]);
  });

  it("keeps a scheduled meeting that is still running (end in the future) upcoming", async () => {
    m("A", "running", "scheduled", "2026-11-03T09:30:00.000Z", {
      scheduled_end_at: "2026-11-03T10:30:00.000Z",
    });
    const { sections } = await inbox();
    expect(ids(sections.upcoming.items)).toEqual(["running"]);
  });

  it("assumes one hour for a scheduled meeting without an end", async () => {
    m("A", "just-over", "scheduled", "2026-11-03T08:59:00.000Z");
    m("A", "still-on", "scheduled", "2026-11-03T09:01:00.000Z");
    const { sections } = await inbox();
    expect(ids(sections.upcoming.items)).toEqual(["still-on"]);
    expect(ids(sections.missed.items)).toEqual(["just-over"]);
  });

  it("lists a scheduled meeting that is over and never started as missed, newest first", async () => {
    m("A", "old", "scheduled", "2026-10-01T09:00:00.000Z", {
      scheduled_end_at: "2026-10-01T09:30:00.000Z",
    });
    m("A", "newer", "scheduled", "2026-11-01T09:00:00.000Z", {
      scheduled_end_at: "2026-11-01T09:30:00.000Z",
    });
    const { sections } = await inbox();
    expect(ids(sections.missed.items)).toEqual(["newer", "old"]);
    expect(sections.upcoming.items).toEqual([]);
  });

  it("never lists deleting or deleted meetings, so no title of one leaks", async () => {
    m("A", "gone1", "deleting", "2026-11-04T09:00:00.000Z", { title: "Secret deletion" });
    m("A", "gone2", "deleted", "2026-11-04T09:00:00.000Z");
    m("A", "ok", "scheduled", "2026-11-04T09:00:00.000Z");
    const result = await inbox();
    expect(JSON.stringify(result)).not.toContain("Secret deletion");
    expect(ids(result.sections.upcoming.items)).toEqual(["ok"]);
    expect(result.sections.inProgress.total).toBe(0);
  });

  it("is owner-scoped: another owner's meetings never appear in any section or count", async () => {
    m("B", "b1", "scheduled", "2026-11-04T09:00:00.000Z", { title: "Bens roadmap" });
    m("B", "b2", "review", "2026-11-02T09:00:00.000Z", { title: "Bens draft" });
    m("B", "b3", "processing", "2026-11-02T09:00:00.000Z", { title: "Bens processing" });
    m("A", "a1", "review", "2026-11-02T09:00:00.000Z");
    const result = await inbox();
    expect(JSON.stringify(result)).not.toContain("Bens");
    expect(result.sections.drafts.total).toBe(1);
    expect(result.sections.upcoming.total).toBe(0);
    expect(result.sections.inProgress.total).toBe(0);
  });

  it("caps a section and reports the real total so the page can say there is more", async () => {
    for (let i = 0; i < INBOX_SECTION_LIMIT + 3; i += 1) {
      m("A", `d${String(i).padStart(3, "0")}`, "review", `2026-10-${String((i % 28) + 1).padStart(2, "0")}T09:00:00.000Z`);
    }
    const { sections } = await inbox();
    expect(sections.drafts.items).toHaveLength(INBOX_SECTION_LIMIT);
    expect(sections.drafts.total).toBe(INBOX_SECTION_LIMIT + 3);
  });

  it("carries the card fields: attendees, consent and folder context, without emails or notes", async () => {
    m("A", "d1", "review", "2026-11-02T09:00:00.000Z");
    attendee(db, "A", "d1", "a1", { email: "grace@example.com" });
    note(db, "A", "d1", "n1", { status: "draft" });
    const { sections } = await inbox();
    expect(sections.drafts.items[0]).toMatchObject({
      id: "d1",
      status: "review",
      attendeeCount: 1,
      noteStatus: "draft",
      folderName: null,
    });
    expect(JSON.stringify(sections)).not.toContain("grace@example.com");
  });

  it("returns the owner's folders for the chips", async () => {
    folder(db, "A", "f1", { name: "Board" });
    folder(db, "B", "fb", { name: "Bens" });
    const { folders } = await inbox();
    expect(folders.map((f) => f.name)).toEqual(["Board"]);
  });
});

describe("loadAllNotes", () => {
  it("lists every non-deleted meeting of the owner, newest first", async () => {
    m("A", "s", "scheduled", "2026-11-05T09:00:00.000Z");
    m("A", "r", "review", "2026-11-04T09:00:00.000Z");
    m("A", "p", "published", "2026-10-01T09:00:00.000Z");
    m("A", "a", "archived", "2026-09-01T09:00:00.000Z");
    m("A", "x", "deleting", "2026-11-06T09:00:00.000Z", { title: "Secret deletion" });
    m("A", "y", "deleted", "2026-11-07T09:00:00.000Z");
    m("B", "b", "published", "2026-11-08T09:00:00.000Z", { title: "Bens roadmap" });
    const result = await all();
    expect(ids(result.items)).toEqual(["s", "r", "p", "a"]);
    expect(result.total).toBe(4);
    expect(JSON.stringify(result)).not.toContain("Secret deletion");
    expect(JSON.stringify(result)).not.toContain("Bens");
  });

  it("filters by status: Draft, Published and Archived each show only theirs", async () => {
    m("A", "r", "review", "2026-11-04T09:00:00.000Z");
    m("A", "p", "published", "2026-10-01T09:00:00.000Z");
    m("A", "a", "archived", "2026-09-01T09:00:00.000Z");
    m("A", "s", "scheduled", "2026-11-05T09:00:00.000Z");
    expect(ids((await all({ status: "draft" })).items)).toEqual(["r"]);
    expect(ids((await all({ status: "published" })).items)).toEqual(["p"]);
    expect(ids((await all({ status: "archived" })).items)).toEqual(["a"]);
    expect((await all({ status: "draft" })).total).toBe(1);
  });

  it("filters by folder: only published notes filed there; a foreign or unknown folder matches nothing", async () => {
    folder(db, "A", "f1", { name: "Board" });
    folder(db, "B", "fb", { name: "Bens" });
    m("A", "in", "published", "2026-10-01T09:00:00.000Z");
    note(db, "A", "in", "n-in", { status: "published", published_at: T0, folder_id: "f1" });
    m("A", "out", "published", "2026-10-02T09:00:00.000Z");
    m("B", "bm", "published", "2026-10-03T09:00:00.000Z", { title: "Bens roadmap" });
    note(db, "B", "bm", "n-bm", { status: "published", published_at: T0, folder_id: "fb" });
    expect(ids((await all({ folderId: "f1" })).items)).toEqual(["in"]);
    const foreign = await all({ folderId: "fb" });
    expect(foreign.items).toEqual([]);
    expect(foreign.total).toBe(0);
    expect((await all({ folderId: "nope" })).items).toEqual([]);
    expect(ids((await all({ folderId: "fb" }, "B")).items)).toEqual(["bm"]);
  });

  it("combines status and folder", async () => {
    folder(db, "A", "f1", { name: "Board" });
    m("A", "p", "published", "2026-10-01T09:00:00.000Z");
    note(db, "A", "p", "n-p", { status: "published", published_at: T0, folder_id: "f1" });
    expect(ids((await all({ status: "published", folderId: "f1" })).items)).toEqual(["p"]);
    expect((await all({ status: "draft", folderId: "f1" })).items).toEqual([]);
  });

  it("paginates with the folder view's window: pages of 25, the last page clamped, junk is page 1", async () => {
    for (let i = 1; i <= FOLDER_PAGE_SIZE + 2; i += 1) {
      m("A", `m${String(i).padStart(2, "0")}`, "published", `2026-07-${String(i).padStart(2, "0")}T09:00:00.000Z`);
    }
    const first = await all();
    expect(first.items).toHaveLength(FOLDER_PAGE_SIZE);
    expect(first.total).toBe(FOLDER_PAGE_SIZE + 2);
    expect(first.page).toMatchObject({ page: 1, pageCount: 2, hasNext: true, hasPrevious: false });
    expect(first.items[0]?.id).toBe("m27");
    const second = await all({ page: "2" });
    expect(ids(second.items)).toEqual(["m02", "m01"]);
    expect(second.page.hasPrevious).toBe(true);
    expect(ids((await all({ page: "999" })).items)).toEqual(["m02", "m01"]);
    expect((await all({ page: "abc" })).items).toHaveLength(FOLDER_PAGE_SIZE);
  });

  it("returns the owner's folders, with counts, for the chips", async () => {
    folder(db, "A", "f1", { name: "Board" });
    folder(db, "B", "fb", { name: "Bens" });
    expect((await all()).folders.map((f) => f.name)).toEqual(["Board"]);
  });
});

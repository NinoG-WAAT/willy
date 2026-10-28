import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { SqliteMeetingCatalog } from "../../../src/adapters/sqlite/meeting-catalog";
import { SqliteSearchIndex } from "../../../src/adapters/sqlite/search-index";
import { FixedClock, SequentialIds } from "../../../src/adapters/system/fakes";
import { searchNotes, type SearchDeps } from "../../../src/app/search/search";
import { HIT_END, HIT_START } from "../../../src/domain/search/highlight";
import { makeEvent } from "../../support/calendar-fixtures";
import { T0, folder, freshDb, insert, meeting, note, owner } from "../../support/db-fixtures";

let db: DatabaseSync;
let catalog: SqliteMeetingCatalog;
let deps: SearchDeps;
let clock: FixedClock;

beforeEach(() => {
  db = freshDb();
  clock = new FixedClock(new Date("2026-10-27T10:00:00.000Z"));
  catalog = new SqliteMeetingCatalog(db, new SequentialIds("id"), clock);
  deps = { index: new SqliteSearchIndex(db) };
  owner(db, "A");
  owner(db, "B");
});

function indexRow(
  ownerId: string,
  meetingId: string,
  kind: string,
  refId: string,
  title: string,
  body: string,
) {
  insert(db, "search_index", {
    title,
    body,
    owner_id: ownerId,
    meeting_id: meetingId,
    kind,
    ref_id: refId,
  });
}

async function hitsOf(
  ownerId: string,
  q: string,
  extra: { folderId?: string | null; includeArchived?: boolean } = {},
) {
  const result = await run(ownerId, q, extra);
  return result.ok ? result.value.hits : [];
}

const run = (
  ownerId: string,
  q: string,
  extra: { folderId?: string | null; includeArchived?: boolean } = {},
) =>
  searchNotes(deps, ownerId, {
    q,
    folderId: extra.folderId ?? null,
    includeArchived: extra.includeArchived ?? false,
  });

describe("searchNotes", () => {
  it("finds a note section with a highlighted snippet and the meeting's context", async () => {
    folder(db, "A", "f1", { name: "Board" });
    meeting(db, "A", "m1", {
      title: "Weekly sync",
      status: "published",
      consent_confirmed_at: T0,
      consent_statement_version: 1,
    });
    note(db, "A", "m1", "n1", { status: "published", published_at: T0, folder_id: "f1" });
    indexRow(
      "A",
      "m1",
      "note_section",
      "s1",
      "Summary",
      "The team agreed the beta ships in November.",
    );

    const result = await run("A", "beta november");
    expect(result).toMatchObject({
      ok: true,
      value: {
        hits: [
          {
            meetingId: "m1",
            kind: "note_section",
            refId: "s1",
            meetingTitle: "Weekly sync",
            folderName: "Board",
            status: "published",
          },
        ],
      },
    });
    const hit = result.ok ? result.value.hits[0] : undefined;
    const marked = (hit?.segments ?? []).filter((s) => s.hit).map((s) => s.text.toLowerCase());
    expect(marked).toEqual(expect.arrayContaining(["beta", "november"]));
    expect((hit?.segments ?? []).map((s) => s.text).join("")).toContain("agreed the");
  });

  it("matches word starts (type-ahead) and ignores case and accents", async () => {
    meeting(db, "A", "m1");
    indexRow("A", "m1", "meeting", "m1", "Café planning", "negotiations");
    expect((await hitsOf("A", "negot")).length).toBe(1);
    expect((await hitsOf("A", "CAFE")).length).toBe(1);
  });

  it("never returns another owner's content, even for an identical term (owner filter is in the query)", async () => {
    meeting(db, "A", "ma");
    meeting(db, "B", "mb");
    indexRow("A", "ma", "meeting", "ma", "Acquisition talks A", "alpha secret");
    indexRow("B", "mb", "meeting", "mb", "Acquisition talks B", "beta secret");
    const a = await run("A", "secret");
    const b = await run("B", "secret");
    expect(a.ok && a.value.hits.map((h) => h.meetingId)).toEqual(["ma"]);
    expect(b.ok && b.value.hits.map((h) => h.meetingId)).toEqual(["mb"]);
    expect(JSON.stringify(a)).not.toContain("beta secret");
  });

  it("excludes meetings being deleted at once (the trigger removes hits in the same transaction)", async () => {
    meeting(db, "A", "m1");
    indexRow("A", "m1", "meeting", "m1", "Doomed", "findable words");
    expect(await hitsOf("A", "findable")).toHaveLength(1);
    db.prepare("UPDATE meeting SET status = 'deleting' WHERE id = 'm1'").run();
    const after = await run("A", "findable");
    expect(after.ok && after.value.hits).toEqual([]);
  });

  it("hides archived meetings unless asked", async () => {
    meeting(db, "A", "m1", { status: "archived", status_before_archive: "scheduled" });
    indexRow("A", "m1", "meeting", "m1", "Old kickoff", "dusty words");
    expect(await hitsOf("A", "dusty")).toEqual([]);
    const included = await run("A", "dusty", { includeArchived: true });
    expect(included.ok && included.value.hits).toHaveLength(1);
  });

  it("filters by folder; another owner's folder id matches nothing", async () => {
    folder(db, "A", "f1");
    folder(db, "B", "fb");
    meeting(db, "A", "m1", {
      status: "published",
      consent_confirmed_at: T0,
      consent_statement_version: 1,
    });
    note(db, "A", "m1", "n1", { status: "published", published_at: T0, folder_id: "f1" });
    meeting(db, "A", "m2");
    indexRow("A", "m1", "meeting", "m1", "Filed", "shared term");
    indexRow("A", "m2", "meeting", "m2", "Unfiled", "shared term");
    const filed = await run("A", "shared", { folderId: "f1" });
    expect(filed.ok && filed.value.hits.map((h) => h.meetingId)).toEqual(["m1"]);
    const foreign = await run("A", "shared", { folderId: "fb" });
    expect(foreign.ok && foreign.value.hits).toEqual([]);
  });

  it("ranks a title match above a body mention", async () => {
    meeting(db, "A", "m1");
    meeting(db, "A", "m2");
    indexRow("A", "m1", "meeting", "m1", "Unrelated", "we briefly mentioned pricing here");
    indexRow("A", "m2", "meeting", "m2", "Pricing review", "something else entirely");
    const result = await run("A", "pricing");
    expect(result.ok && result.value.hits.map((h) => h.meetingId)).toEqual(["m2", "m1"]);
  });

  it("treats search syntax as plain words: no error, no operators, no column filters", async () => {
    meeting(db, "A", "m1");
    indexRow("A", "m1", "meeting", "m1", "Plain", "alpha beta");
    for (const q of [
      'alpha" OR "beta',
      "title:alpha",
      "alpha*",
      "NEAR(alpha beta)",
      "alpha -beta",
      '"',
      "(((",
      "a AND NOT b",
    ]) {
      const result = await run("A", q);
      expect(result.ok || result.error.field === "q").toBe(true);
    }
    const phraseAttack = await run("A", 'zzz" OR "alpha');
    expect(phraseAttack.ok && phraseAttack.value.hits).toEqual([]);
  });

  it("reports an invalid query as a field error and an empty result as success", async () => {
    expect(await run("A", "   ")).toMatchObject({ ok: false, error: { field: "q" } });
    expect(await run("A", "nothingmatches")).toEqual({
      ok: true,
      value: { hits: [], terms: ["nothingmatches"] },
    });
  });

  it("caps the number of hits", async () => {
    meeting(db, "A", "m1");
    for (let i = 0; i < 80; i++)
      indexRow("A", "m1", "decision", `d${String(i)}`, "Decision", `common word ${String(i)}`);
    const result = await run("A", "common");
    expect(result.ok && result.value.hits.length).toBe(50);
  });

  it("never lets a marker character from stored text change what is highlighted", async () => {
    meeting(db, "A", "m1");
    indexRow("A", "m1", "meeting", "m1", "Odd", `alpha ${HIT_START}forged${HIT_END} beta`);
    const result = await run("A", "alpha");
    const text = result.ok
      ? (result.value.hits[0]?.segments ?? []).filter((s) => s.hit).map((s) => s.text)
      : [];
    expect(text).toEqual(["alpha"]);
  });
});

describe("keeping the meeting rows of the index current", () => {
  it("a new meeting is searchable by title and agenda at once, only by its owner", async () => {
    await catalog.create(
      "A",
      {
        title: "Investor update",
        startsAt: "2026-11-03T08:00:00.000Z",
        endsAt: "2026-11-03T08:30:00.000Z",
        timezone: "UTC",
        agenda: "Discuss runway",
        templateId: null,
        attendees: [],
      },
      "key-1",
    );
    const mine = await run("A", "runway");
    expect(mine.ok && mine.value.hits[0]).toMatchObject({
      kind: "meeting",
      meetingTitle: "Investor update",
    });
    expect(await hitsOf("B", "runway")).toEqual([]);
    expect(await hitsOf("A", "investor")).toHaveLength(1);
  });

  it("saving rough notes updates the index: new words are found, replaced words are not", async () => {
    meeting(db, "A", "m1", { title: "Sync" });
    await catalog.saveRoughNotes("A", "m1", "talked about acquisitions", clock.now());
    expect(await hitsOf("A", "acquisitions")).toHaveLength(1);
    await catalog.saveRoughNotes("A", "m1", "talked about hiring", clock.now());
    expect(await hitsOf("A", "acquisitions")).toEqual([]);
    expect(await hitsOf("A", "hiring")).toHaveLength(1);
    expect(
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM search_index WHERE meeting_id = 'm1' AND kind = 'meeting'",
        )
        .get()?.["n"],
    ).toBe(1);
  });

  it("a calendar import indexes the title and a re-import with a new title replaces it", async () => {
    await catalog.upsertFromCalendar("A", makeEvent("e1", { title: "Board prep" }));
    expect(await hitsOf("A", "board")).toHaveLength(1);
    await catalog.upsertFromCalendar("A", makeEvent("e1", { title: "Retreat planning" }));
    expect(await hitsOf("A", "board")).toEqual([]);
    expect(await hitsOf("A", "retreat")).toHaveLength(1);
  });

  it("rebuilding fills in meetings that have no row yet, without duplicating existing rows", async () => {
    meeting(db, "A", "m1", { title: "Seeded meeting", agenda: "legacy agenda" });
    meeting(db, "A", "m2", { title: "Already indexed" });
    indexRow("A", "m2", "meeting", "m2", "Already indexed", "");
    const index = new SqliteSearchIndex(db);
    index.rebuildMissingMeetingRows();
    index.rebuildMissingMeetingRows();
    expect(await hitsOf("A", "legacy")).toHaveLength(1);
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM search_index WHERE kind = 'meeting'").get()?.["n"],
    ).toBe(2);
  });

  it("a meeting in deleting state is never re-indexed by a later notes save", async () => {
    meeting(db, "A", "m1", { status: "deleting" });
    expect(await catalog.saveRoughNotes("A", "m1", "late edit", clock.now())).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM search_index WHERE meeting_id = 'm1'").get()?.["n"],
    ).toBe(0);
  });
});

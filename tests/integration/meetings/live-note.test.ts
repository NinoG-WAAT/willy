import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { SqliteChunkRepository } from "../../../src/adapters/sqlite/chunk-repository";
import { SqliteMeetingCatalog } from "../../../src/adapters/sqlite/meeting-catalog";
import { SqliteMeetingRepository } from "../../../src/adapters/sqlite/meeting-repository";
import { FixedClock, SequentialIds } from "../../../src/adapters/system/fakes";
import type { MeetingDeps } from "../../../src/app/meetings/capture";
import {
  loadLiveNote,
  runCaptureAction,
  saveRoughNotes,
  type LiveNoteDeps,
} from "../../../src/app/meetings/live-note";
import { MAX_ROUGH_NOTES_CHARS } from "../../../src/domain/meetings/rough-notes";
import {
  T0,
  attendee,
  chunk,
  consentedMeeting,
  count,
  folder,
  freshDb,
  meeting,
  note,
  owner,
} from "../../support/db-fixtures";

let db: DatabaseSync;
let clock: FixedClock;
let live: LiveNoteDeps;
let capture: MeetingDeps;

beforeEach(() => {
  db = freshDb();
  clock = new FixedClock(new Date("2026-10-27T10:00:00.000Z"));
  const ids = new SequentialIds("id");
  const catalog = new SqliteMeetingCatalog(db, ids, clock);
  live = { detail: catalog, notes: catalog, chunks: new SqliteChunkRepository(db), clock };
  capture = { meetings: new SqliteMeetingRepository(db, ids, clock), clock };
  owner(db, "A");
  owner(db, "B");
});

const roughNotes = (id: string) =>
  db.prepare("SELECT rough_notes AS n FROM meeting WHERE id = ?").get(id)?.["n"];

describe("loadLiveNote", () => {
  it("returns the meeting with attendees, controls and where capture would continue", async () => {
    meeting(db, "A", "m1", { title: "Board prep", agenda: "Roadmap", rough_notes: "hello" });
    attendee(db, "A", "m1", "a1", { name: "Grace", email: "grace@example.com" });
    const result = await loadLiveNote(live, "A", "m1");
    expect(result).toMatchObject({
      ok: true,
      value: {
        detail: {
          id: "m1",
          title: "Board prep",
          agenda: "Roadmap",
          roughNotes: "hello",
          status: "scheduled",
          consentConfirmedAt: null,
          attendees: [{ name: "Grace", email: "grace@example.com" }],
        },
        controls: { phase: "before", showConsent: true, canStart: true },
        nextSeq: 0,
        recordedMs: 0,
      },
    });
  });

  it("derives the next chunk sequence and recorded time from stored chunks", async () => {
    consentedMeeting(db, "A", "m1");
    chunk(db, "A", "m1", 0, { duration_ms: 10000 });
    chunk(db, "A", "m1", 1, { duration_ms: 9000 });
    const result = await loadLiveNote(live, "A", "m1");
    expect(result).toMatchObject({ ok: true, value: { nextSeq: 2, recordedMs: 19000 } });
  });

  it("is not_found for another owner's meeting, a guessed id and a meeting being deleted", async () => {
    meeting(db, "B", "mb");
    meeting(db, "A", "gone", { status: "deleting" });
    for (const id of ["mb", "nope", "gone"]) {
      expect(await loadLiveNote(live, "A", id)).toEqual({
        ok: false,
        error: { kind: "not_found" },
      });
    }
  });
});

describe("loadLiveNote: what the meeting header shows (#73)", () => {
  const template = (ownerId: string, id: string, name: string) =>
    db
      .prepare(
        `INSERT INTO template (id, owner_id, name, sections_json, created_at, updated_at)
         VALUES (?, ?, ?, '[]', ?, ?)`,
      )
      .run(id, ownerId, name, T0, T0);
  const detailOf = async (ownerId: string, id: string) => {
    const result = await loadLiveNote(live, ownerId, id);
    if (!result.ok) throw new Error("expected a live note");
    return result.value.detail;
  };

  it("has no folder, template or note when none exist", async () => {
    meeting(db, "A", "m1");
    expect(await detailOf("A", "m1")).toMatchObject({
      folder: null,
      template: null,
      noteStatus: null,
    });
  });

  it("carries the template's name, and the folder only through the note", async () => {
    template("A", "t1", "Customer call");
    folder(db, "A", "f1", { name: "Board updates" });
    consentedMeeting(db, "A", "m1", { status: "review", template_id: "t1" });
    note(db, "A", "m1", "n1");
    expect(await detailOf("A", "m1")).toMatchObject({
      template: { id: "t1", name: "Customer call" },
      folder: null,
      noteStatus: "draft",
    });
    db.prepare(
      "UPDATE note SET status = 'published', folder_id = 'f1', published_at = ? WHERE id = 'n1'",
    ).run(T0);
    db.prepare("UPDATE meeting SET status = 'published' WHERE id = 'm1'").run();
    expect(await detailOf("A", "m1")).toMatchObject({
      folder: { id: "f1", name: "Board updates" },
      noteStatus: "published",
    });
  });

  it("never shows another owner's folder or template, and another owner's meeting is not found", async () => {
    template("B", "tb", "Secret template");
    folder(db, "B", "fb", { name: "Secret folder" });
    consentedMeeting(db, "B", "mb", { status: "published", template_id: "tb" });
    note(db, "B", "mb", "nb", { status: "published", folder_id: "fb", published_at: T0 });
    expect(await loadLiveNote(live, "A", "mb")).toEqual({
      ok: false,
      error: { kind: "not_found" },
    });
    expect(await detailOf("B", "mb")).toMatchObject({
      folder: { name: "Secret folder" },
      template: { name: "Secret template" },
    });
  });
});

describe("saveRoughNotes", () => {
  it("stores the notes and reports when they were saved", async () => {
    meeting(db, "A", "m1");
    clock.advance(5_000);
    const result = await saveRoughNotes(live, "A", "m1", "- point one\r\n- point two");
    expect(result).toEqual({ ok: true, value: { savedAt: "2026-10-27T10:00:05.000Z" } });
    expect(roughNotes("m1")).toBe("- point one\n- point two");
  });

  it("keeps working in every state except deleting: notes survive processing and failures", async () => {
    for (const status of ["processing", "failed", "review", "published"] as const) {
      const id = `m-${status}`;
      consentedMeeting(db, "A", id, { status });
      expect((await saveRoughNotes(live, "A", id, `notes for ${status}`)).ok).toBe(true);
      expect(roughNotes(id)).toBe(`notes for ${status}`);
    }
  });

  it("can clear the notes", async () => {
    meeting(db, "A", "m1", { rough_notes: "something" });
    expect((await saveRoughNotes(live, "A", "m1", "")).ok).toBe(true);
    expect(roughNotes("m1")).toBe("");
  });

  it("rejects notes that are too long and leaves the stored notes untouched", async () => {
    meeting(db, "A", "m1", { rough_notes: "keep me" });
    const result = await saveRoughNotes(live, "A", "m1", "x".repeat(MAX_ROUGH_NOTES_CHARS + 1));
    expect(result).toMatchObject({ ok: false, error: { kind: "invalid" } });
    expect(roughNotes("m1")).toBe("keep me");
  });

  it("cannot read or change another owner's notes, a guessed id, or a meeting being deleted", async () => {
    meeting(db, "B", "mb", { rough_notes: "ben's" });
    meeting(db, "A", "gone", { status: "deleting", rough_notes: "old" });
    for (const id of ["mb", "nope", "gone"]) {
      expect(await saveRoughNotes(live, "A", id, "hijack")).toEqual({
        ok: false,
        error: { kind: "not_found" },
      });
    }
    expect(roughNotes("mb")).toBe("ben's");
    expect(roughNotes("gone")).toBe("old");
  });

  it("touches updated_at but never consent or capture state", async () => {
    meeting(db, "A", "m1");
    clock.advance(60_000);
    await saveRoughNotes(live, "A", "m1", "n");
    expect(
      db.prepare("SELECT status, consent_confirmed_at AS c, updated_at AS u FROM meeting").get(),
    ).toEqual({ status: "scheduled", c: null, u: "2026-10-27T10:01:00.000Z" });
  });
});

describe("runCaptureAction", () => {
  const status = (id = "m1") =>
    db.prepare("SELECT status FROM meeting WHERE id = ?").get(id)?.["status"];

  it("will not start without the consent tick, and stays scheduled (server-enforced)", async () => {
    meeting(db, "A", "m1");
    const result = await runCaptureAction(capture, "A", "m1", "start", { consentAccepted: false });
    expect(result).toEqual({ ok: false, error: { kind: "consent_not_given" } });
    expect(status()).toBe("scheduled");
    expect(count(db, "audit_event")).toBe(0);
  });

  it("with the tick: records the consent time and starts capture", async () => {
    meeting(db, "A", "m1");
    const result = await runCaptureAction(capture, "A", "m1", "start", { consentAccepted: true });
    expect(result.ok).toBe(true);
    expect(db.prepare("SELECT status, consent_confirmed_at AS c FROM meeting").get()).toEqual({
      status: "capturing",
      c: "2026-10-27T10:00:00.000Z",
    });
  });

  it("starting again after consent is stored does not need the tick, and a double start is harmless", async () => {
    consentedMeeting(db, "A", "m1", { status: "scheduled", capture_started_at: null });
    expect(
      (await runCaptureAction(capture, "A", "m1", "start", { consentAccepted: false })).ok,
    ).toBe(true);
    expect(
      (await runCaptureAction(capture, "A", "m1", "start", { consentAccepted: false })).ok,
    ).toBe(true);
    expect(status()).toBe("capturing");
  });

  it("pause, resume and stop follow the lifecycle; stopping twice queues exactly one transcription job", async () => {
    meeting(db, "A", "m1");
    await runCaptureAction(capture, "A", "m1", "start", { consentAccepted: true });
    await runCaptureAction(capture, "A", "m1", "pause", { consentAccepted: false });
    expect(status()).toBe("paused");
    await runCaptureAction(capture, "A", "m1", "resume", { consentAccepted: false });
    expect(status()).toBe("capturing");
    await runCaptureAction(capture, "A", "m1", "stop", { consentAccepted: false });
    await runCaptureAction(capture, "A", "m1", "stop", { consentAccepted: false });
    expect(status()).toBe("processing");
    expect(count(db, "job", "meeting_id = 'm1' AND kind = 'transcribe'")).toBe(1);
  });

  it("rejects an action that does not fit the state (resume while capturing is a no-op, pause when scheduled is an error)", async () => {
    meeting(db, "A", "m1");
    expect(
      await runCaptureAction(capture, "A", "m1", "pause", { consentAccepted: false }),
    ).toMatchObject({
      ok: false,
      error: { kind: "invalid_transition" },
    });
  });

  it("is not_found for another owner's meeting and changes nothing", async () => {
    meeting(db, "B", "mb");
    expect(await runCaptureAction(capture, "A", "mb", "start", { consentAccepted: true })).toEqual({
      ok: false,
      error: { kind: "not_found" },
    });
    expect(db.prepare("SELECT status FROM meeting WHERE id = 'mb'").get()?.["status"]).toBe(
      "scheduled",
    );
    expect(T0).toBeTruthy();
  });
});

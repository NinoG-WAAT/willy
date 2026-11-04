import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { DEV_KEYRING } from "../../../src/adapters/crypto/dev-keyring";
import { createEnvelopeCipher, parseKeyring } from "../../../src/adapters/crypto/envelope-cipher";
import { createFakeSummarizer } from "../../../src/adapters/llm/fake-summarizer";
import { createCaptureLogger } from "../../../src/adapters/logging/json-logger";
import { SqliteJobRepository } from "../../../src/adapters/sqlite/job-repository";
import { SqliteMeetingRepository } from "../../../src/adapters/sqlite/meeting-repository";
import { SqliteNoteRepository } from "../../../src/adapters/sqlite/note-repository";
import { SqliteTemplateRepository } from "../../../src/adapters/sqlite/template-repository";
import { SqliteVocabularyRepository } from "../../../src/adapters/sqlite/vocabulary-repository";
import { FixedClock, SequentialIds } from "../../../src/adapters/system/fakes";
import { runDueJobs, type RunnerDeps } from "../../../src/app/jobs/runner";
import {
  requestDraftRegeneration,
  type RegenerateDraftDeps,
} from "../../../src/app/notes/regenerate-draft";
import { summaryJobHandler, type SummaryDeps } from "../../../src/app/notes/summary-job";
import type { SummarizerInput } from "../../../src/domain/notes/summary";
import { segmentTextContext } from "../../../src/domain/transcription/encryption-context";
import type { Summarizer } from "../../../src/ports/summarizer";
import {
  T0,
  attendee,
  chunk,
  consentedMeeting,
  count,
  freshDb,
  insert,
  note,
  owner,
  segment,
} from "../../support/db-fixtures";

const textCipher = createEnvelopeCipher(parseKeyring(DEV_KEYRING.spec), DEV_KEYRING.activeKeyId);

let db: DatabaseSync;
let clock: FixedClock;
let fake: ReturnType<typeof createFakeSummarizer>;
let inputs: SummarizerInput[];
let regen: RegenerateDraftDeps;
let deps: SummaryDeps;
let runner: RunnerDeps;

beforeEach(async () => {
  db = freshDb();
  clock = new FixedClock(new Date("2026-10-27T10:00:00.000Z"));
  fake = createFakeSummarizer();
  inputs = [];
  const recording: Summarizer = {
    summarize: (input) => {
      inputs.push(input);
      return fake.summarize(input);
    },
  };
  const ids = new SequentialIds("id");
  const meetings = new SqliteMeetingRepository(db, ids, clock);
  const jobs = new SqliteJobRepository(db, ids);
  const notes = new SqliteNoteRepository(db, new SequentialIds("note"));
  const logger = createCaptureLogger();
  regen = { meetings, notes, jobs, clock };
  deps = {
    meetings,
    notes,
    templates: new SqliteTemplateRepository(db),
    vocabulary: new SqliteVocabularyRepository(db),
    summarizer: recording,
    textCipher,
    clock,
    logger,
  };
  runner = { jobs, clock, logger, random: () => 0, leaseMs: 5 * 60_000 };

  owner(db, "A");
  owner(db, "B");
  consentedMeeting(db, "A", "m1", {
    status: "review",
    timezone: "Europe/Paris",
    rough_notes: "My own rough notes",
  });
  attendee(db, "A", "m1", "a1", { name: "Ada Lovelace" });
  note(db, "A", "m1", "n1");
  const section = (id: string, position: number, heading: string, body: string, edited = 0) =>
    insert(db, "note_section", {
      id,
      owner_id: "A",
      note_id: "n1",
      position,
      heading,
      body,
      source_from: 0,
      source_to: 1,
      edited,
      created_at: T0,
      updated_at: T0,
    });
  section("s-summary", 0, "Summary", "Original summary.");
  section("s-risks", 1, "Risks", "Owner rewrote the risks by hand.", 1);
  section("s-next", 2, "Next steps", "Original next steps.");
  insert(db, "decision", {
    id: "d1",
    owner_id: "A",
    note_id: "n1",
    position: 0,
    text: "Ship in November",
    source_from: 1,
    source_to: 1,
    edited: 1,
    created_at: T0,
    updated_at: T0,
  });
  insert(db, "action_item", {
    id: "i1",
    owner_id: "A",
    meeting_id: "m1",
    note_id: "n1",
    position: 0,
    text: "Send the deck",
    assignee_attendee_id: "a1",
    status: "open",
    source_from: 1,
    source_to: 1,
    edited: 1,
    created_at: T0,
    updated_at: T0,
  });
  for (const [id, heading, body] of [
    ["s-summary", "Summary", "Original summary."],
    ["s-risks", "Risks", "Owner rewrote the risks by hand."],
    ["s-next", "Next steps", "Original next steps."],
  ] as const) {
    insert(db, "search_index", {
      title: heading,
      body,
      owner_id: "A",
      meeting_id: "m1",
      kind: "note_section",
      ref_id: id,
    });
  }
  chunk(db, "A", "m1", 0, { state: "purged", object_key: null, purged_at: T0 });
  for (const [i, text] of [
    "Let's review the roadmap.",
    "We agreed to ship in November.",
  ].entries()) {
    const id = `m1-seg-${String(i)}`;
    const sealed = await textCipher.encrypt(text, segmentTextContext(id));
    segment(db, "A", "m1", 0, i, {
      id,
      text_ciphertext: sealed.ciphertext,
      text_key_id: sealed.keyId,
    });
  }
});

const request = (ownerId = "A", meetingId = "m1", confirmed = true) =>
  requestDraftRegeneration(regen, ownerId, meetingId, { confirmed });
const run = () => runDueJobs(runner, [summaryJobHandler(deps)]);
const sections = () =>
  db
    .prepare(
      "SELECT heading, body, source_from, source_to, edited FROM note_section ORDER BY position",
    )
    .all();
const jobs = () =>
  db
    .prepare("SELECT job_key, status, attempts, payload_json FROM job ORDER BY created_at, id")
    .all();
const revision = () => db.prepare("SELECT revision FROM note").get();

const NEW_DRAFT = {
  sections: [
    { heading: "Summary", body: "A real summary of the meeting.", source_from: 0, source_to: 1 },
    { heading: "Discussion", body: "Pricing deck is late.", source_from: 1, source_to: 1 },
  ],
  decisions: [{ text: "Ship in November", source_from: 1, source_to: 1 }],
  action_items: [
    {
      text: "Send the pricing deck",
      assignee_id: "a1",
      due_date: "2026-11-06",
      source_from: 1,
      source_to: 1,
    },
  ],
};

describe("requesting a whole-draft regeneration", () => {
  it("queues one job per note revision, and a double click queues nothing more", async () => {
    expect(await request()).toEqual({
      ok: true,
      value: { jobKey: "summarize:m1:r1:all", alreadyQueued: false },
    });
    expect(await request()).toEqual({
      ok: true,
      value: { jobKey: "summarize:m1:r1:all", alreadyQueued: true },
    });
    expect(jobs()).toEqual([
      expect.objectContaining({
        job_key: "summarize:m1:r1:all",
        status: "pending",
        payload_json: JSON.stringify({ scope: "all", revision: 1 }),
      }),
    ]);
  });

  it("is refused without the owner's confirmation: it replaces their edits", async () => {
    expect(await request("A", "m1", false)).toEqual({
      ok: false,
      error: { kind: "not_confirmed" },
    });
    expect(count(db, "job")).toBe(0);
  });

  it.each(["published", "processing", "failed", "scheduled"] as const)(
    "refuses while the meeting is %s (only a draft in review can be regenerated)",
    async (status) => {
      db.prepare("UPDATE meeting SET status = ? WHERE id = 'm1'").run(status);
      if (status === "scheduled")
        db.prepare(
          "UPDATE meeting SET consent_confirmed_at = NULL, consent_statement_version = NULL, capture_started_at = NULL WHERE id = 'm1'",
        ).run();
      expect(await request()).toEqual({ ok: false, error: { kind: "invalid_state", status } });
      expect(count(db, "job")).toBe(0);
    },
  );

  it("is not found for another owner, an unknown id, a deleting meeting and a meeting without a note", async () => {
    consentedMeeting(db, "A", "m2", { status: "review" });
    consentedMeeting(db, "A", "m3", { status: "review" });
    note(db, "A", "m3", "n3");
    db.prepare("UPDATE meeting SET status = 'deleting' WHERE id = 'm3'").run();
    for (const [o, meetingId] of [
      ["B", "m1"],
      ["A", "missing"],
      ["A", "m2"],
      ["A", "m3"],
    ] as const) {
      expect(await request(o, meetingId)).toEqual({ ok: false, error: { kind: "not_found" } });
    }
    expect(count(db, "job")).toBe(0);
  });
});

describe("regenerating the whole draft", () => {
  it("replaces every section, decision and action item with the new draft and keeps the rest", async () => {
    await request();
    fake.script.respondOnce(NEW_DRAFT);
    await run();

    expect(sections()).toEqual([
      {
        heading: "Summary",
        body: "A real summary of the meeting.",
        source_from: 0,
        source_to: 1,
        edited: 0,
      },
      {
        heading: "Discussion",
        body: "Pricing deck is late.",
        source_from: 1,
        source_to: 1,
        edited: 0,
      },
    ]);
    expect(db.prepare("SELECT text, edited FROM decision").all()).toEqual([
      { text: "Ship in November", edited: 0 },
    ]);
    expect(
      db.prepare("SELECT text, assignee_attendee_id, edited, status FROM action_item").all(),
    ).toEqual([
      { text: "Send the pricing deck", assignee_attendee_id: "a1", edited: 0, status: "open" },
    ]);
    // Same note, still a draft, revision raised; rough notes, transcript and meeting untouched.
    expect(
      db.prepare("SELECT id, status, revision, folder_id, published_at FROM note").get(),
    ).toEqual({
      id: "n1",
      status: "draft",
      revision: 2,
      folder_id: null,
      published_at: null,
    });
    expect(db.prepare("SELECT status, rough_notes FROM meeting WHERE id = 'm1'").get()).toEqual({
      status: "review",
      rough_notes: "My own rough notes",
    });
    expect(count(db, "transcript_segment")).toBe(2);
  });

  it("asks the model for the whole template, with the transcript and attendees, never for one section", async () => {
    insert(db, "template", {
      id: "t1",
      owner_id: "A",
      name: "Weekly",
      sections_json: JSON.stringify([
        { heading: "Summary", prompt: "Summarize." },
        { heading: "Risks", prompt: "List only real risks." },
      ]),
      is_default: 0,
      created_at: T0,
      updated_at: T0,
    });
    db.prepare("UPDATE meeting SET template_id = 't1' WHERE id = 'm1'").run();
    await request();
    await run();
    const input = inputs[0];
    expect(input?.only).toBeNull();
    expect(input?.template?.sections.map((s) => s.heading)).toEqual(["Summary", "Risks"]);
    expect(input?.segments.map((s) => s.text)).toEqual([
      "Let's review the roadmap.",
      "We agreed to ship in November.",
    ]);
    expect(input?.attendees).toEqual([{ id: "a1", name: "Ada Lovelace" }]);
  });

  it("refreshes the search rows: old text is gone, new text is findable", async () => {
    await request();
    fake.script.respondOnce(NEW_DRAFT);
    await run();
    const rows = db
      .prepare(
        "SELECT kind, body FROM search_index WHERE meeting_id = 'm1' AND kind <> 'meeting' ORDER BY kind, body",
      )
      .all();
    expect(rows).toEqual([
      { kind: "action_item", body: "Send the pricing deck" },
      { kind: "decision", body: "Ship in November" },
      { kind: "note_section", body: "A real summary of the meeting." },
      { kind: "note_section", body: "Pricing deck is late." },
    ]);
  });

  it("appends an audit event with ids and the revision only", async () => {
    await request();
    await run();
    expect(
      db
        .prepare(
          "SELECT meeting_id, kind, actor, detail_json FROM audit_event WHERE kind = 'note.draft_regenerated'",
        )
        .all(),
    ).toEqual([
      {
        meeting_id: "m1",
        kind: "note.draft_regenerated",
        actor: "owner",
        detail_json: JSON.stringify({ fromRevision: 1 }),
      },
    ]);
  });

  it("a second request after completion queues a new job for the new revision", async () => {
    await request();
    await run();
    expect(await request()).toEqual({
      ok: true,
      value: { jobKey: "summarize:m1:r2:all", alreadyQueued: false },
    });
    await run();
    expect(revision()).toEqual({ revision: 3 });
  });

  it("running the same job twice changes nothing the second time", async () => {
    await request();
    await run();
    const before = JSON.stringify([sections(), revision()]);
    db.prepare("UPDATE job SET status = 'pending', attempts = 0, next_run_at = NULL").run();
    const calls = inputs.length;
    await run();
    expect(JSON.stringify([sections(), revision()])).toBe(before);
    expect(inputs).toHaveLength(calls);
  });

  it("a note the owner edited after the request is not overwritten (stale revision)", async () => {
    await request();
    db.prepare("UPDATE note SET revision = revision + 1").run();
    await run();
    expect(inputs).toHaveLength(0);
    expect(sections()).toHaveLength(3);
    expect(db.prepare("SELECT status FROM job").get()).toEqual({ status: "succeeded" });
  });

  it("does nothing if the note was published meanwhile", async () => {
    await request();
    db.prepare("UPDATE meeting SET status = 'published' WHERE id = 'm1'").run();
    await run();
    expect(inputs).toHaveLength(0);
    expect(sections()).toHaveLength(3);
  });

  it("never wipes the draft when there is no transcript to write a new one from", async () => {
    await request();
    db.prepare("DELETE FROM transcript_segment").run();
    await run();
    expect(inputs).toHaveLength(0);
    expect(sections()).toHaveLength(3);
  });

  it("never touches another owner's note", async () => {
    consentedMeeting(db, "B", "mB", { status: "review" });
    note(db, "B", "mB", "nB");
    insert(db, "note_section", {
      id: "sB",
      owner_id: "B",
      note_id: "nB",
      position: 0,
      heading: "Summary",
      body: "B private",
      created_at: T0,
      updated_at: T0,
    });
    await request();
    await run();
    expect(db.prepare("SELECT body FROM note_section WHERE id = 'sB'").get()).toEqual({
      body: "B private",
    });
    expect(db.prepare("SELECT revision FROM note WHERE id = 'nB'").get()).toEqual({ revision: 1 });
  });
});

describe("a failed regeneration keeps the previous draft", () => {
  it("a transient failure retries and the draft stays as it was until it succeeds", async () => {
    await request();
    fake.script.failOnce("unavailable");
    await run();
    expect(db.prepare("SELECT status, last_error_code FROM job").get()).toEqual({
      status: "retrying",
      last_error_code: "llm_unavailable",
    });
    expect(sections()).toHaveLength(3);
    expect(revision()).toEqual({ revision: 1 });
    clock.advance(10 * 60_000);
    await run();
    expect(db.prepare("SELECT status FROM job").get()).toEqual({ status: "succeeded" });
    expect(revision()).toEqual({ revision: 2 });
  });

  it("a permanent failure fails only the job: draft and meeting stay, and a new request retries", async () => {
    await request();
    fake.script.failOnce("rejected");
    await run();
    expect(db.prepare("SELECT status, last_error_code FROM job").get()).toEqual({
      status: "failed",
      last_error_code: "llm_rejected",
    });
    expect(db.prepare("SELECT status FROM meeting WHERE id = 'm1'").get()).toEqual({
      status: "review",
    });
    expect(sections()).toHaveLength(3);
    expect(revision()).toEqual({ revision: 1 });

    expect(await request()).toMatchObject({ ok: true, value: { alreadyQueued: false } });
    expect(db.prepare("SELECT status, attempts FROM job").get()).toEqual({
      status: "pending",
      attempts: 0,
    });
    await run();
    expect(db.prepare("SELECT status FROM job").get()).toEqual({ status: "succeeded" });
  });

  it("an ungrounded answer is not applied", async () => {
    await request();
    fake.script.respondOnce({
      sections: [{ heading: "Summary", body: "Made up.", source_from: 999, source_to: 999 }],
      decisions: [],
      action_items: [],
    });
    await run();
    expect(sections()).toHaveLength(3);
    expect(revision()).toEqual({ revision: 1 });
    expect(db.prepare("SELECT status FROM job").get()).toEqual({ status: "retrying" });
  });
});

describe("regenerating the whole draft with the owner's vocabulary (issue #110)", () => {
  it("gives the summarizer the owner's terms, and only theirs", async () => {
    insert(db, "vocabulary_term", { id: "v1", owner_id: "A", term: "SALSA", created_at: T0 });
    insert(db, "vocabulary_term", { id: "v2", owner_id: "B", term: "Secret of B", created_at: T0 });
    await request();
    await run();
    expect(inputs[0]?.vocabulary).toEqual(["SALSA"]);
  });
});

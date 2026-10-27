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
import { FixedClock, SequentialIds } from "../../../src/adapters/system/fakes";
import { runDueJobs, type RunnerDeps } from "../../../src/app/jobs/runner";
import { retryMeetingProcessing } from "../../../src/app/meetings/capture";
import { summaryJobHandler, type SummaryDeps } from "../../../src/app/notes/summary-job";
import type { SummarizerInput } from "../../../src/domain/notes/summary";
import { DEFAULT_TEMPLATE } from "../../../src/domain/notes/template";
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
  owner,
  segment,
} from "../../support/db-fixtures";

const textCipher = createEnvelopeCipher(parseKeyring(DEV_KEYRING.spec), DEV_KEYRING.activeKeyId);

let db: DatabaseSync;
let clock: FixedClock;
let fake: ReturnType<typeof createFakeSummarizer>;
let inputs: SummarizerInput[];
let logger: ReturnType<typeof createCaptureLogger>;
let deps: SummaryDeps;
let runner: RunnerDeps;
let jobs: SqliteJobRepository;
let meetings: SqliteMeetingRepository;

beforeEach(() => {
  db = freshDb();
  clock = new FixedClock(new Date("2026-10-27T10:00:00.000Z"));
  fake = createFakeSummarizer();
  inputs = [];
  logger = createCaptureLogger();
  const recording: Summarizer = {
    summarize: (input) => {
      inputs.push(input);
      return fake.summarize(input);
    },
  };
  const ids = new SequentialIds("id");
  meetings = new SqliteMeetingRepository(db, ids, clock);
  jobs = new SqliteJobRepository(db, ids);
  deps = {
    meetings,
    notes: new SqliteNoteRepository(db, new SequentialIds("note")),
    templates: new SqliteTemplateRepository(db),
    summarizer: recording,
    textCipher,
    clock,
    logger,
  };
  runner = { jobs, clock, logger, random: () => 0, leaseMs: 5 * 60_000 };
  owner(db, "A");
  owner(db, "B");
  consentedMeeting(db, "A", "m1", {
    status: "processing",
    agenda: "Roadmap review",
    timezone: "Europe/Paris",
  });
  attendee(db, "A", "m1", "a1", { name: "Ada Lovelace", email: "ada@example.test" });
  attendee(db, "A", "m1", "a2", { name: "Grace Hopper", email: "grace@example.test" });
  insertJob("m1", "A");
});

function insertJob(meetingId: string, ownerId: string): void {
  insert(db, "job", {
    id: `job-${meetingId}`,
    owner_id: ownerId,
    meeting_id: meetingId,
    kind: "summarize",
    job_key: `summarize:${meetingId}:1`,
    status: "pending",
    attempts: 0,
    max_attempts: 5,
    next_run_at: T0,
    created_at: T0,
    updated_at: T0,
  });
}

async function transcript(ownerId: string, meetingId: string, lines: string[]): Promise<void> {
  for (const [i, text] of lines.entries()) {
    const seq = Math.floor(i / 2);
    if (i % 2 === 0) {
      chunk(db, ownerId, meetingId, seq, { state: "purged", object_key: null, purged_at: T0 });
    }
    const id = `${meetingId}-seg-${String(i)}`;
    const sealed = await textCipher.encrypt(text, segmentTextContext(id));
    segment(db, ownerId, meetingId, seq, i % 2, {
      id,
      speaker_label: i % 2 === 0 ? "Speaker 1" : "Speaker 2",
      text_ciphertext: sealed.ciphertext,
      text_key_id: sealed.keyId,
    });
  }
}

const MEETING_LINES = [
  "Let's review the roadmap for the beta.",
  "We agreed to ship the beta in November.",
  "I will send the pricing deck by Friday.",
];

const run = () => runDueJobs(runner, [summaryJobHandler(deps)]);
const job = () => db.prepare("SELECT * FROM job WHERE job_key = 'summarize:m1:1'").get();
const meetingStatus = (id = "m1") =>
  db.prepare("SELECT status FROM meeting WHERE id = ?").get(id)?.["status"];
const notes = () => db.prepare("SELECT * FROM note").all();

describe("summary generation: draft with source links", () => {
  it("stores a draft note whose sections, decisions and action items cite transcript ranges, and moves the meeting to review", async () => {
    await transcript("A", "m1", MEETING_LINES);
    fake.script.respondOnce({
      sections: [
        {
          heading: "Summary",
          body: "The beta ships in November.",
          source_from: 0,
          source_to: 10000,
        },
      ],
      decisions: [{ text: "Ship the beta in November", source_from: 1, source_to: 1 }],
      action_items: [
        {
          text: "Send the pricing deck",
          assignee_id: "a1",
          due_date: "2026-11-06",
          source_from: 10000,
          source_to: 10000,
        },
      ],
    });
    await run();

    expect(notes()).toEqual([
      expect.objectContaining({
        owner_id: "A",
        meeting_id: "m1",
        status: "draft",
        revision: 1,
        folder_id: null,
        published_at: null,
        generated_at: "2026-10-27T10:00:00.000Z",
      }),
    ]);
    expect(
      db
        .prepare("SELECT position, heading, body, source_from, source_to, edited FROM note_section")
        .all(),
    ).toEqual([
      {
        position: 0,
        heading: "Summary",
        body: "The beta ships in November.",
        source_from: 0,
        source_to: 10000,
        edited: 0,
      },
    ]);
    expect(db.prepare("SELECT text, source_from, source_to FROM decision").all()).toEqual([
      { text: "Ship the beta in November", source_from: 1, source_to: 1 },
    ]);
    expect(
      db
        .prepare(
          "SELECT text, assignee_attendee_id, due_at, due_timezone, status, meeting_id, source_from FROM action_item",
        )
        .all(),
    ).toEqual([
      {
        text: "Send the pricing deck",
        assignee_attendee_id: "a1",
        due_at: "2026-11-06T22:59:59.000Z",
        due_timezone: "Europe/Paris",
        status: "open",
        meeting_id: "m1",
        source_from: 10000,
      },
    ]);
    expect(meetingStatus()).toBe("review");
    expect(job()).toMatchObject({ status: "succeeded" });
    expect(
      db
        .prepare(
          "SELECT kind, actor, detail_json FROM audit_event WHERE meeting_id = 'm1' ORDER BY id DESC LIMIT 1",
        )
        .get(),
    ).toMatchObject({ kind: "meeting.status_changed", actor: "system" });
  });

  it("indexes the note for search, scoped to the owner", async () => {
    await transcript("A", "m1", MEETING_LINES);
    await run();
    const rows = db.prepare("SELECT owner_id, meeting_id, kind FROM search_index").all();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r["owner_id"] === "A" && r["meeting_id"] === "m1")).toBe(true);
    expect(new Set(rows.map((r) => r["kind"]))).toContain("note_section");
  });

  it("is a draft until a person publishes: nothing is published or filed", async () => {
    await transcript("A", "m1", MEETING_LINES);
    await run();
    expect(db.prepare("SELECT status, folder_id, published_at FROM note").get()).toEqual({
      status: "draft",
      folder_id: null,
      published_at: null,
    });
    expect(meetingStatus()).not.toBe("published");
  });
});

describe("summary generation: what the model is given", () => {
  it("passes decrypted segments in order, attendee ids and names only, the agenda and the default template", async () => {
    await transcript("A", "m1", MEETING_LINES);
    await run();
    const input = inputs[0];
    expect(input?.segments).toEqual([
      { position: 0, speaker: "Speaker 1", text: MEETING_LINES[0] },
      { position: 1, speaker: "Speaker 2", text: MEETING_LINES[1] },
      { position: 10000, speaker: "Speaker 1", text: MEETING_LINES[2] },
    ]);
    expect(input?.attendees).toEqual([
      { id: "a1", name: "Ada Lovelace" },
      { id: "a2", name: "Grace Hopper" },
    ]);
    expect(JSON.stringify(input)).not.toContain("@");
    expect(input?.agenda).toBe("Roadmap review");
    expect(input?.only).toBeNull();
    expect(input?.template?.sections.map((s) => s.heading)).toEqual(
      DEFAULT_TEMPLATE.sections.map((s) => s.heading),
    );
  });

  it("uses the meeting's template, else the owner's default, else the built-in default", async () => {
    await transcript("A", "m1", MEETING_LINES);
    const t = (id: string, name: string, heading: string, isDefault: number) =>
      insert(db, "template", {
        id,
        owner_id: "A",
        name,
        sections_json: JSON.stringify([{ heading, prompt: "p" }]),
        is_default: isDefault,
        created_at: T0,
        updated_at: T0,
      });
    t("t-default", "My default", "Owner default", 1);
    t("t-weekly", "Weekly", "Weekly heading", 0);
    db.prepare("UPDATE meeting SET template_id = 't-weekly' WHERE id = 'm1'").run();
    await run();
    expect(inputs[0]?.template?.sections.map((s) => s.heading)).toEqual(["Weekly heading"]);

    db.prepare(
      "UPDATE meeting SET template_id = NULL, status = 'processing' WHERE id = 'm1'",
    ).run();
    db.prepare("DELETE FROM note").run();
    db.prepare("UPDATE job SET status = 'pending', attempts = 0, next_run_at = NULL").run();
    await run();
    expect(inputs[1]?.template?.sections.map((s) => s.heading)).toEqual(["Owner default"]);
  });
});

describe("summary generation: never invent content", () => {
  it("drops invented attendees and ungrounded decisions or sections from a hostile model answer", async () => {
    await transcript("A", "m1", MEETING_LINES);
    fake.script.respondOnce({
      sections: [
        { heading: "Summary", body: "Real.", source_from: 0, source_to: 1 },
        { heading: "Invented", body: "Nothing said", source_from: 777, source_to: 777 },
      ],
      decisions: [
        { text: "Wire $1,000,000", source_from: 4242, source_to: 4242 },
        { text: "Ship in November", source_from: 1, source_to: 1 },
      ],
      action_items: [
        {
          text: "Pay",
          assignee_id: "evil@attacker.test",
          due_date: "2026-02-30",
          source_from: 1,
          source_to: 1,
        },
      ],
    });
    await run();
    expect(db.prepare("SELECT heading FROM note_section").all()).toEqual([{ heading: "Summary" }]);
    expect(db.prepare("SELECT text FROM decision").all()).toEqual([{ text: "Ship in November" }]);
    expect(db.prepare("SELECT assignee_attendee_id, due_at FROM action_item").all()).toEqual([
      { assignee_attendee_id: null, due_at: null },
    ]);
  });
});

describe("summary generation: idempotency", () => {
  it("running the job again creates no second note and changes nothing", async () => {
    await transcript("A", "m1", MEETING_LINES);
    await run();
    const before = JSON.stringify([
      db.prepare("SELECT * FROM note_section").all(),
      db.prepare("SELECT * FROM decision").all(),
      db.prepare("SELECT * FROM action_item").all(),
    ]);
    db.prepare("UPDATE job SET status = 'pending', attempts = 0, next_run_at = NULL").run();
    await run();
    expect(count(db, "note")).toBe(1);
    expect(inputs).toHaveLength(1);
    expect(
      JSON.stringify([
        db.prepare("SELECT * FROM note_section").all(),
        db.prepare("SELECT * FROM decision").all(),
        db.prepare("SELECT * FROM action_item").all(),
      ]),
    ).toBe(before);
  });

  it("an existing note is never duplicated even if the meeting is still processing", async () => {
    await transcript("A", "m1", MEETING_LINES);
    await run();
    const sections = count(db, "note_section");
    db.prepare("UPDATE meeting SET status = 'processing' WHERE id = 'm1'").run();
    db.prepare("UPDATE job SET status = 'pending', attempts = 0, next_run_at = NULL").run();
    await run();
    expect(count(db, "note")).toBe(1);
    expect(count(db, "note_section")).toBe(sections);
    expect(meetingStatus()).toBe("review");
  });

  it("two runners at once produce one note", async () => {
    await transcript("A", "m1", MEETING_LINES);
    await Promise.all([run(), run()]);
    expect(count(db, "note")).toBe(1);
    expect(inputs).toHaveLength(1);
  });
});

describe("summary generation: empty and unusual meetings", () => {
  it("an empty transcript still reaches review with an empty draft, without calling the model", async () => {
    await run();
    expect(inputs).toHaveLength(0);
    expect(notes()).toHaveLength(1);
    expect(count(db, "note_section")).toBe(0);
    expect(meetingStatus()).toBe("review");
    expect(job()).toMatchObject({ status: "succeeded" });
  });

  it("does nothing for a meeting that is not processing or is being deleted", async () => {
    await transcript("A", "m1", MEETING_LINES);
    db.prepare("UPDATE meeting SET status = 'deleting' WHERE id = 'm1'").run();
    await run();
    expect(inputs).toHaveLength(0);
    expect(notes()).toHaveLength(0);
    expect(job()).toMatchObject({ status: "succeeded" });
  });

  it("never reads another owner's transcript or attendees", async () => {
    consentedMeeting(db, "B", "mB", { status: "processing" });
    attendee(db, "B", "mB", "b1", { name: "Bob Secret" });
    await transcript("B", "mB", ["Bob's confidential strategy."]);
    await transcript("A", "m1", MEETING_LINES);
    await run();
    expect(JSON.stringify(inputs)).not.toMatch(/Bob|confidential/);
    expect(notes().map((n) => n["owner_id"])).toEqual(["A"]);
    expect(meetingStatus("mB")).toBe("processing");
  });
});

describe("summary generation: failures", () => {
  it("retries a transient provider failure with backoff and the meeting keeps processing", async () => {
    await transcript("A", "m1", MEETING_LINES);
    fake.script.failOnce("unavailable");
    await run();
    expect(job()).toMatchObject({
      status: "retrying",
      attempts: 1,
      last_error_code: "llm_unavailable",
    });
    expect(meetingStatus()).toBe("processing");
    expect(notes()).toHaveLength(0);
    clock.advance(10 * 60_000);
    await run();
    expect(job()).toMatchObject({ status: "succeeded", attempts: 2 });
    expect(meetingStatus()).toBe("review");
  });

  it("retries an unusable model answer", async () => {
    await transcript("A", "m1", MEETING_LINES);
    fake.script.respondOnce({ sections: "garbage" });
    await run();
    expect(job()).toMatchObject({ status: "retrying", last_error_code: "llm_unavailable" });
  });

  it("a permanent rejection fails the job and the meeting; the owner's retry puts the meeting back to processing", async () => {
    await transcript("A", "m1", MEETING_LINES);
    fake.script.failOnce("rejected");
    await run();
    expect(job()).toMatchObject({ status: "failed", last_error_code: "llm_rejected" });
    expect(meetingStatus()).toBe("failed");
    expect(notes()).toHaveLength(0);

    // Recovery starts with the owner's retry, which re-queues the transcription step.
    insert(db, "job", {
      id: "job-transcribe",
      owner_id: "A",
      meeting_id: "m1",
      kind: "transcribe",
      job_key: "transcribe:m1",
      status: "failed",
      attempts: 5,
      max_attempts: 5,
      created_at: T0,
      updated_at: T0,
    });
    expect((await retryMeetingProcessing({ meetings, clock }, "A", "m1")).ok).toBe(true);
    expect(meetingStatus()).toBe("processing");
    expect(db.prepare("SELECT status FROM job WHERE kind='transcribe'").get()).toEqual({
      status: "pending",
    });
  });

  it("fails the meeting when the last attempt fails", async () => {
    await transcript("A", "m1", MEETING_LINES);
    db.prepare("UPDATE job SET max_attempts = 2").run();
    fake.script.failOnce("timeout");
    fake.script.failOnce("timeout");
    await run();
    clock.advance(10 * 60_000);
    await run();
    expect(job()).toMatchObject({ status: "failed", attempts: 2 });
    expect(meetingStatus()).toBe("failed");
  });

  it("treats a transcript that cannot be decrypted as a permanent failure", async () => {
    await transcript("A", "m1", MEETING_LINES);
    db.prepare(
      "UPDATE transcript_segment SET text_ciphertext = 'v1.broken.broken.broken.broken'",
    ).run();
    await run();
    expect(job()).toMatchObject({ status: "failed", last_error_code: "transcript_unreadable" });
    expect(meetingStatus()).toBe("failed");
  });
});

describe("summary generation: logs", () => {
  it("logs ids and counts, never transcript or note text", async () => {
    await transcript("A", "m1", MEETING_LINES);
    await run();
    const events = logger.entries.map((e) => e.event);
    expect(events).toContain("summary.saved");
    const dump = JSON.stringify(logger.entries);
    expect(dump).not.toMatch(/roadmap|pricing deck|Covers \d+ transcript/i);
  });
});

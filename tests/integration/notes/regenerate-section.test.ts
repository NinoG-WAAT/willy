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
import {
  requestSectionRegeneration,
  type RegenerateDeps,
} from "../../../src/app/notes/regenerate-section";
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
let regen: RegenerateDeps;
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
    summarizer: recording,
    textCipher,
    clock,
    logger,
  };
  runner = { jobs, clock, logger, random: () => 0, leaseMs: 5 * 60_000 };

  owner(db, "A");
  owner(db, "B");
  consentedMeeting(db, "A", "m1", { status: "review", timezone: "Europe/Paris" });
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

const request = (sectionId: string, ownerId = "A", meetingId = "m1") =>
  requestSectionRegeneration(regen, ownerId, meetingId, sectionId);
const run = () => runDueJobs(runner, [summaryJobHandler(deps)]);
const sections = () =>
  db
    .prepare(
      "SELECT id, heading, body, source_from, source_to, edited FROM note_section ORDER BY position",
    )
    .all();
const jobs = () =>
  db
    .prepare("SELECT job_key, status, attempts, payload_json FROM job ORDER BY created_at, id")
    .all();

describe("requesting a regeneration", () => {
  it("queues one job per section and revision, and a double click queues nothing more", async () => {
    expect(await request("s-risks")).toEqual({
      ok: true,
      value: { jobKey: "summarize:m1:r1:s-risks", alreadyQueued: false },
    });
    expect(await request("s-risks")).toEqual({
      ok: true,
      value: { jobKey: "summarize:m1:r1:s-risks", alreadyQueued: true },
    });
    expect(jobs()).toEqual([
      expect.objectContaining({
        job_key: "summarize:m1:r1:s-risks",
        status: "pending",
        payload_json: JSON.stringify({ sectionId: "s-risks", revision: 1 }),
      }),
    ]);
  });

  it("allows other sections at the same time", async () => {
    await request("s-risks");
    await request("s-next");
    expect(count(db, "job")).toBe(2);
  });

  it.each(["published", "processing", "failed", "scheduled"] as const)(
    "refuses while the meeting is %s (only a draft in review can be regenerated)",
    async (status) => {
      db.prepare("UPDATE meeting SET status = ? WHERE id = 'm1'").run(status);
      if (status === "scheduled")
        db.prepare(
          "UPDATE meeting SET consent_confirmed_at = NULL, consent_statement_version = NULL, capture_started_at = NULL WHERE id = 'm1'",
        ).run();
      expect(await request("s-risks")).toEqual({
        ok: false,
        error: { kind: "invalid_state", status },
      });
      expect(count(db, "job")).toBe(0);
    },
  );

  it("is not found for another owner, an unknown section, a section of another meeting and a deleting meeting", async () => {
    consentedMeeting(db, "A", "m2", { status: "review" });
    note(db, "A", "m2", "n2");
    insert(db, "note_section", {
      id: "s-other",
      owner_id: "A",
      note_id: "n2",
      position: 0,
      heading: "Summary",
      body: "x",
      created_at: T0,
      updated_at: T0,
    });
    db.prepare("UPDATE meeting SET status = 'deleting' WHERE id = 'm2'").run();
    for (const [o, meetingId, sectionId] of [
      ["B", "m1", "s-risks"],
      ["A", "m1", "nope"],
      ["A", "m1", "s-other"],
      ["A", "m2", "s-other"],
      ["A", "missing", "s-risks"],
    ] as const) {
      expect(await request(sectionId, o, meetingId)).toEqual({
        ok: false,
        error: { kind: "not_found" },
      });
    }
    expect(count(db, "job")).toBe(0);
  });
});

describe("regenerating one section", () => {
  it("replaces only the chosen section and keeps every manual edit elsewhere", async () => {
    await request("s-summary");
    fake.script.respondOnce({
      sections: [
        {
          heading: "whatever",
          body: "Fresh summary from the transcript.",
          source_from: 0,
          source_to: 1,
        },
      ],
      decisions: [{ text: "Smuggled decision", source_from: 1, source_to: 1 }],
      action_items: [
        { text: "Smuggled task", assignee_id: null, due_date: null, source_from: 1, source_to: 1 },
      ],
    });
    await run();

    expect(sections()).toEqual([
      {
        id: "s-summary",
        heading: "Summary",
        body: "Fresh summary from the transcript.",
        source_from: 0,
        source_to: 1,
        edited: 0,
      },
      {
        id: "s-risks",
        heading: "Risks",
        body: "Owner rewrote the risks by hand.",
        source_from: 0,
        source_to: 1,
        edited: 1,
      },
      {
        id: "s-next",
        heading: "Next steps",
        body: "Original next steps.",
        source_from: 0,
        source_to: 1,
        edited: 0,
      },
    ]);
    expect(db.prepare("SELECT text, edited FROM decision").all()).toEqual([
      { text: "Ship in November", edited: 1 },
    ]);
    expect(db.prepare("SELECT text, edited FROM action_item").all()).toEqual([
      { text: "Send the deck", edited: 1 },
    ]);
    expect(db.prepare("SELECT status, revision, folder_id, published_at FROM note").get()).toEqual({
      status: "draft",
      revision: 2,
      folder_id: null,
      published_at: null,
    });
    expect(db.prepare("SELECT status FROM meeting WHERE id = 'm1'").get()).toEqual({
      status: "review",
    });
  });

  it("asks the model for exactly that section, with the template's prompt, and the same input guarantees", async () => {
    insert(db, "template", {
      id: "t1",
      owner_id: "A",
      name: "Weekly",
      sections_json: JSON.stringify([{ heading: "Risks", prompt: "List only real risks." }]),
      is_default: 0,
      created_at: T0,
      updated_at: T0,
    });
    db.prepare("UPDATE meeting SET template_id = 't1' WHERE id = 'm1'").run();
    await request("s-risks");
    await run();
    const input = inputs[0];
    expect(input?.only).toEqual({ heading: "Risks", prompt: "List only real risks." });
    expect(input?.segments.map((s) => s.text)).toEqual([
      "Let's review the roadmap.",
      "We agreed to ship in November.",
    ]);
    expect(input?.attendees).toEqual([{ id: "a1", name: "Ada Lovelace" }]);
  });

  it("uses a generic prompt when the template has no such heading", async () => {
    await request("s-next");
    await run();
    expect(inputs[0]?.only?.heading).toBe("Next steps");
    expect(inputs[0]?.only?.prompt.length).toBeGreaterThan(10);
  });

  it("updates the search row of that section only, leaving no stale text behind", async () => {
    await request("s-summary");
    fake.script.respondOnce({
      sections: [
        {
          heading: "Summary",
          body: "Brand new wording about pricing.",
          source_from: 0,
          source_to: 1,
        },
      ],
      decisions: [],
      action_items: [],
    });
    await run();
    const rows = db
      .prepare("SELECT ref_id, body FROM search_index WHERE kind = 'note_section' ORDER BY ref_id")
      .all();
    expect(rows).toEqual([
      { ref_id: "s-next", body: "Original next steps." },
      { ref_id: "s-risks", body: "Owner rewrote the risks by hand." },
      { ref_id: "s-summary", body: "Brand new wording about pricing." },
    ]);
  });

  it("a second request after completion queues a new job for the new revision", async () => {
    await request("s-summary");
    await run();
    expect(await request("s-summary")).toEqual({
      ok: true,
      value: { jobKey: "summarize:m1:r2:s-summary", alreadyQueued: false },
    });
    await run();
    expect(db.prepare("SELECT revision FROM note").get()).toEqual({ revision: 3 });
  });

  it("running the same job twice changes nothing the second time", async () => {
    await request("s-summary");
    await run();
    const before = JSON.stringify([sections(), db.prepare("SELECT revision FROM note").get()]);
    db.prepare("UPDATE job SET status = 'pending', attempts = 0, next_run_at = NULL").run();
    const calls = inputs.length;
    await run();
    expect(JSON.stringify([sections(), db.prepare("SELECT revision FROM note").get()])).toBe(
      before,
    );
    expect(inputs).toHaveLength(calls);
  });
});

describe("regeneration failures leave the draft alone", () => {
  it("a transient failure retries and the section stays as it was until it succeeds", async () => {
    await request("s-summary");
    fake.script.failOnce("unavailable");
    await run();
    expect(db.prepare("SELECT status, last_error_code FROM job").get()).toEqual({
      status: "retrying",
      last_error_code: "llm_unavailable",
    });
    expect(sections()[0]).toMatchObject({ body: "Original summary." });
    clock.advance(10 * 60_000);
    await run();
    expect(db.prepare("SELECT status FROM job").get()).toEqual({ status: "succeeded" });
    expect(sections()[0]?.["body"]).not.toBe("Original summary.");
  });

  it("a permanent failure fails only the job: the note and the meeting stay as they are, and a new request retries", async () => {
    await request("s-summary");
    fake.script.failOnce("rejected");
    await run();
    expect(db.prepare("SELECT status, last_error_code FROM job").get()).toEqual({
      status: "failed",
      last_error_code: "llm_rejected",
    });
    expect(db.prepare("SELECT status FROM meeting WHERE id = 'm1'").get()).toEqual({
      status: "review",
    });
    expect(sections()[0]).toMatchObject({ body: "Original summary.", edited: 0 });
    expect(db.prepare("SELECT revision FROM note").get()).toEqual({ revision: 1 });

    expect(await request("s-summary")).toMatchObject({ ok: true, value: { alreadyQueued: false } });
    expect(db.prepare("SELECT status, attempts FROM job").get()).toEqual({
      status: "pending",
      attempts: 0,
    });
    await run();
    expect(db.prepare("SELECT status FROM job").get()).toEqual({ status: "succeeded" });
  });

  it("an ungrounded answer is not applied", async () => {
    await request("s-summary");
    fake.script.respondOnce({
      sections: [{ heading: "Summary", body: "Made up.", source_from: 999, source_to: 999 }],
      decisions: [],
      action_items: [],
    });
    await run();
    expect(db.prepare("SELECT status, last_error_code FROM job").get()).toEqual({
      status: "retrying",
      last_error_code: "llm_unavailable",
    });
    expect(sections()[0]).toMatchObject({ body: "Original summary." });
  });

  it("a section that disappeared before the job ran is a quiet no-op", async () => {
    await request("s-next");
    db.prepare("DELETE FROM note_section WHERE id = 's-next'").run();
    await run();
    expect(db.prepare("SELECT status FROM job").get()).toEqual({ status: "succeeded" });
    expect(inputs).toHaveLength(0);
    expect(sections().map((s) => s["id"])).toEqual(["s-summary", "s-risks"]);
  });

  it("does nothing if the note was published or the meeting reopened elsewhere meanwhile", async () => {
    await request("s-summary");
    db.prepare("UPDATE meeting SET status = 'published' WHERE id = 'm1'").run();
    await run();
    expect(inputs).toHaveLength(0);
    expect(sections()[0]).toMatchObject({ body: "Original summary." });
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
    await request("s-summary");
    await run();
    expect(db.prepare("SELECT body FROM note_section WHERE id = 'sB'").get()).toEqual({
      body: "B private",
    });
    expect(db.prepare("SELECT revision FROM note WHERE id = 'nB'").get()).toEqual({ revision: 1 });
  });
});

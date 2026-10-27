import { describe, expect, it } from "vitest";
import {
  CONSENT_STATEMENT,
  CONSENT_STATEMENT_VERSION,
  archiveMeeting,
  completeDeletion,
  completeProcessing,
  confirmConsent,
  failProcessing,
  pauseCapture,
  publishMeeting,
  reopenMeeting,
  requestDeletion,
  resumeCapture,
  retryProcessing,
  startCapture,
  stopCapture,
  unarchiveMeeting,
  type Meeting,
  type MeetingStatus,
  type TransitionOutcome,
} from "../../../src/domain/meetings/lifecycle";
import type { Result } from "../../../src/domain/platform/result";

const NOW = new Date("2026-10-27T10:00:00.000Z");
const ISO = NOW.toISOString();
const EARLIER = "2026-10-27T09:00:00.000Z";

const ALL: MeetingStatus[] = [
  "scheduled",
  "capturing",
  "paused",
  "processing",
  "review",
  "published",
  "failed",
  "archived",
  "deleting",
  "deleted",
];

function meeting(status: MeetingStatus, overrides: Partial<Meeting> = {}): Meeting {
  const consented = !["scheduled", "archived", "deleting", "deleted"].includes(status);
  return {
    id: "m1",
    ownerId: "A",
    status,
    statusBeforeArchive: status === "archived" ? "review" : null,
    consentConfirmedAt: consented ? EARLIER : null,
    consentStatementVersion: consented ? CONSENT_STATEMENT_VERSION : null,
    captureStartedAt: consented ? EARLIER : null,
    captureEndedAt: null,
    ...overrides,
  };
}

type Action = (m: Meeting) => Result<TransitionOutcome, unknown>;

/** Statuses each action may start from, written independently of the implementation's table. */
const MATRIX: { name: string; run: Action; from: MeetingStatus[]; to: MeetingStatus }[] = [
  {
    name: "startCapture",
    // The consent gate has its own tests below; here consent is already confirmed.
    run: (m) =>
      startCapture(
        { ...m, consentConfirmedAt: EARLIER, consentStatementVersion: CONSENT_STATEMENT_VERSION },
        NOW,
      ),
    from: ["scheduled"],
    to: "capturing",
  },
  { name: "pauseCapture", run: (m) => pauseCapture(m, NOW), from: ["capturing"], to: "paused" },
  { name: "resumeCapture", run: (m) => resumeCapture(m, NOW), from: ["paused"], to: "capturing" },
  {
    name: "stopCapture",
    run: (m) => stopCapture(m, NOW),
    from: ["capturing", "paused"],
    to: "processing",
  },
  {
    name: "completeProcessing",
    run: (m) => completeProcessing(m, NOW),
    from: ["processing"],
    to: "review",
  },
  {
    name: "failProcessing",
    run: (m) => failProcessing(m, NOW),
    from: ["processing"],
    to: "failed",
  },
  {
    name: "retryProcessing",
    run: (m) => retryProcessing(m, NOW),
    from: ["failed"],
    to: "processing",
  },
  {
    name: "publishMeeting",
    run: (m) => publishMeeting(m, { id: "f1", ownerId: "A" }, NOW),
    from: ["review"],
    to: "published",
  },
  { name: "reopenMeeting", run: (m) => reopenMeeting(m, NOW), from: ["published"], to: "review" },
  {
    name: "archiveMeeting",
    run: (m) => archiveMeeting(m, NOW),
    from: ["scheduled", "review", "published", "failed"],
    to: "archived",
  },
  {
    name: "unarchiveMeeting",
    run: (m) => unarchiveMeeting(m, NOW),
    from: ["archived"],
    to: "review",
  },
  {
    name: "requestDeletion",
    run: (m) => requestDeletion(m, NOW),
    from: [
      "scheduled",
      "capturing",
      "paused",
      "processing",
      "review",
      "published",
      "failed",
      "archived",
    ],
    to: "deleting",
  },
  {
    name: "completeDeletion",
    run: (m) => completeDeletion(m, NOW),
    from: ["deleting"],
    to: "deleted",
  },
];

describe("transition table (allowed and forbidden, every status)", () => {
  for (const row of MATRIX) {
    describe(row.name, () => {
      for (const from of row.from) {
        it(`${from} -> ${row.to}`, () => {
          const result = row.run(meeting(from));
          expect(result.ok).toBe(true);
          if (result.ok) {
            expect(result.value.meeting.status).toBe(row.to);
            expect(result.value.changed).toBe(true);
          }
        });
      }

      for (const from of ALL.filter((s) => !row.from.includes(s))) {
        it(`is rejected from ${from} (or is an idempotent repeat of the target state)`, () => {
          const result = row.run(meeting(from));
          if (result.ok) {
            // The only accepted non-transitions are harmless repeats that change nothing.
            expect(result.value.changed).toBe(false);
            expect(result.value.events).toEqual([]);
            expect(result.value.effects).toEqual([]);
            expect(result.value.meeting.status).toBe(from);
          } else {
            expect(result.error).toMatchObject({ kind: "invalid_transition", from });
          }
        });
      }
    });
  }

  it("never allows any transition out of deleting except to deleted, nor out of deleted at all", () => {
    for (const row of MATRIX) {
      for (const from of ["deleting", "deleted"] as const) {
        const result = row.run(meeting(from));
        const legal = from === "deleting" && row.to === "deleted";
        if (!legal && result.ok) expect(result.value.changed).toBe(false);
        if (legal) expect(result.ok && result.value.changed).toBe(true);
      }
    }
  });

  it("rejects the same repeats as no-ops only where double-submit is harmless", () => {
    expect(pauseCapture(meeting("paused"), NOW)).toMatchObject({
      ok: true,
      value: { changed: false },
    });
    expect(resumeCapture(meeting("capturing"), NOW)).toMatchObject({
      ok: true,
      value: { changed: false },
    });
    expect(startCapture(meeting("capturing"), NOW)).toMatchObject({
      ok: true,
      value: { changed: false },
    });
    expect(stopCapture(meeting("processing"), NOW)).toMatchObject({
      ok: true,
      value: { changed: false },
    });
    expect(requestDeletion(meeting("deleting"), NOW)).toMatchObject({
      ok: true,
      value: { changed: false },
    });
    // But stopping something that never started is a real error.
    expect(stopCapture(meeting("scheduled"), NOW)).toMatchObject({
      ok: false,
      error: { kind: "invalid_transition", from: "scheduled" },
    });
  });
});

describe("consent gate (acceptance scenario 1, domain level)", () => {
  it("states the consent statement and its version", () => {
    expect(CONSENT_STATEMENT).toContain("every participant");
    expect(CONSENT_STATEMENT_VERSION).toBeGreaterThanOrEqual(1);
  });

  it("blocks capture until the owner has confirmed consent", () => {
    const result = startCapture(meeting("scheduled"), NOW);
    expect(result).toEqual({ ok: false, error: { kind: "consent_required" } });
  });

  it("records who/when/which statement on confirmation, appends an audit event, and does not start capture", () => {
    const result = confirmConsent(meeting("scheduled"), { accepted: true }, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.meeting.status).toBe("scheduled");
    expect(result.value.meeting.consentConfirmedAt).toBe(ISO);
    expect(result.value.meeting.consentStatementVersion).toBe(CONSENT_STATEMENT_VERSION);
    expect(result.value.events).toEqual([
      {
        kind: "meeting.consent_confirmed",
        actor: "owner",
        detail: { statementVersion: CONSENT_STATEMENT_VERSION },
      },
    ]);
  });

  it("requires an explicit acceptance, never an implied one", () => {
    expect(confirmConsent(meeting("scheduled"), { accepted: false }, NOW)).toEqual({
      ok: false,
      error: { kind: "consent_not_given" },
    });
  });

  it("allows capture after confirmation", () => {
    const confirmed = confirmConsent(meeting("scheduled"), { accepted: true }, NOW);
    if (!confirmed.ok) throw new Error("setup");
    const started = startCapture(confirmed.value.meeting, NOW);
    expect(started.ok && started.value.meeting.status).toBe("capturing");
    expect(started.ok && started.value.meeting.captureStartedAt).toBe(ISO);
  });

  it("keeps the first consent time on repeat confirmation (no-op, no second audit event)", () => {
    const already = meeting("scheduled", {
      consentConfirmedAt: EARLIER,
      consentStatementVersion: CONSENT_STATEMENT_VERSION,
    });
    const result = confirmConsent(already, { accepted: true }, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.changed).toBe(false);
    expect(result.value.meeting.consentConfirmedAt).toBe(EARLIER);
    expect(result.value.events).toEqual([]);
  });

  it("cannot confirm consent for a meeting that is already past capture without it, or is gone", () => {
    for (const status of ["processing", "review", "deleting", "deleted"] as const) {
      const result = confirmConsent(
        meeting(status, { consentConfirmedAt: null, consentStatementVersion: null }),
        { accepted: true },
        NOW,
      );
      expect(result.ok, status).toBe(false);
    }
  });

  it("only ever records the Owner's own confirmation: no attendee consent is created or claimed", () => {
    const result = confirmConsent(meeting("scheduled"), { accepted: true }, NOW);
    if (!result.ok) throw new Error("setup");
    expect(JSON.stringify(result.value)).not.toMatch(/attendee|participant/i);
    expect(Object.keys(result.value.meeting)).not.toContain("attendeeConsent");
  });
});

describe("capture lifecycle details", () => {
  it("stopping queues exactly one transcription job, keyed by meeting, and records the end time", () => {
    const result = stopCapture(meeting("capturing"), NOW);
    if (!result.ok) throw new Error("setup");
    expect(result.value.effects).toEqual([
      {
        kind: "enqueue_job",
        jobKind: "transcribe",
        jobKey: "transcribe:m1",
        requeueIfFailed: false,
      },
    ]);
    expect(result.value.meeting.captureEndedAt).toBe(ISO);
  });

  it("stopping again queues nothing", () => {
    const stopped = stopCapture(meeting("capturing"), NOW);
    if (!stopped.ok) throw new Error("setup");
    const again = stopCapture(stopped.value.meeting, NOW);
    expect(again.ok && again.value.effects).toEqual([]);
  });

  it("can stop from paused", () => {
    expect(stopCapture(meeting("paused"), NOW).ok).toBe(true);
  });

  it("retrying a failed transcription re-queues the same job key, only if it failed", () => {
    const result = retryProcessing(meeting("failed", { captureEndedAt: EARLIER }), NOW);
    if (!result.ok) throw new Error("setup");
    expect(result.value.effects).toEqual([
      {
        kind: "enqueue_job",
        jobKind: "transcribe",
        jobKey: "transcribe:m1",
        requeueIfFailed: true,
      },
    ]);
  });

  it("appends one audit event per transition with from/to and the right actor", () => {
    const owner = pauseCapture(meeting("capturing"), NOW);
    const system = completeProcessing(meeting("processing"), NOW);
    expect(owner.ok && owner.value.events).toEqual([
      {
        kind: "meeting.status_changed",
        actor: "owner",
        detail: { from: "capturing", to: "paused" },
      },
    ]);
    expect(system.ok && system.value.events).toEqual([
      {
        kind: "meeting.status_changed",
        actor: "system",
        detail: { from: "processing", to: "review" },
      },
    ]);
  });

  it("never mutates its input", () => {
    const m = meeting("capturing");
    const copy = structuredClone(m);
    stopCapture(m, NOW);
    expect(m).toEqual(copy);
  });
});

describe("publish, reopen, archive, deletion", () => {
  it("publishes only from review and only into a folder the owner owns", () => {
    expect(publishMeeting(meeting("review"), null, NOW)).toEqual({
      ok: false,
      error: { kind: "folder_required" },
    });
    expect(publishMeeting(meeting("review"), { id: "f9", ownerId: "B" }, NOW)).toEqual({
      ok: false,
      error: { kind: "folder_not_owned" },
    });
    const ok = publishMeeting(meeting("review"), { id: "f1", ownerId: "A" }, NOW);
    expect(ok.ok && ok.value.events[0]).toEqual({
      kind: "meeting.published",
      actor: "owner",
      detail: { from: "review", to: "published", folderId: "f1" },
    });
  });

  it("treats publishing again as a no-op", () => {
    expect(publishMeeting(meeting("published"), { id: "f1", ownerId: "A" }, NOW)).toMatchObject({
      ok: true,
      value: { changed: false, events: [] },
    });
  });

  it("restores the previous status when unarchiving and clears the marker", () => {
    const result = unarchiveMeeting(meeting("archived", { statusBeforeArchive: "published" }), NOW);
    expect(result.ok && result.value.meeting).toMatchObject({
      status: "published",
      statusBeforeArchive: null,
    });
  });

  it("remembers the status it archived from", () => {
    const result = archiveMeeting(meeting("failed"), NOW);
    expect(result.ok && result.value.meeting).toMatchObject({
      status: "archived",
      statusBeforeArchive: "failed",
    });
  });

  it("requesting deletion enqueues exactly one delete job; completing it is system-only terminal", () => {
    const requested = requestDeletion(meeting("review"), NOW);
    if (!requested.ok) throw new Error("setup");
    expect(requested.value.effects).toEqual([
      { kind: "enqueue_job", jobKind: "delete", jobKey: "delete:m1", requeueIfFailed: true },
    ]);
    const done = completeDeletion(requested.value.meeting, NOW);
    expect(done.ok && done.value.events[0]).toMatchObject({ actor: "system" });
    expect(done.ok && done.value.meeting.status).toBe("deleted");
  });
});

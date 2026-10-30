import { describe, expect, it } from "vitest";
import {
  cardProgress,
  deletionRowProgress,
  describeJob,
  parseDeletionsPayload,
  parseProcessingPayload,
  processingProgress,
  regenerationProgress,
  reviewLinkLabel,
  reviewPath,
  stoppedMessage,
  type JobProgress,
  type ProcessingPayload,
} from "../../../src/domain/progress/text";

const job = (over: Partial<JobProgress> = {}): JobProgress => ({
  status: "running",
  attempts: 1,
  maxAttempts: 5,
  nextRunAt: null,
  lastErrorCode: null,
  ...over,
});

const payload = (over: Partial<ProcessingPayload> = {}): ProcessingPayload => ({
  meetingStatus: "processing",
  job: job(),
  summary: null,
  regeneration: null,
  chunks: null,
  ...over,
});

describe("describeJob", () => {
  it.each([
    [null, "Not started"],
    [job({ status: "pending" }), "Waiting to start"],
    [job({ status: "running" }), "Running"],
    [job({ status: "retrying", attempts: 2 }), "Retrying (attempt 2 of 5)"],
    [
      job({ status: "failed", attempts: 5, lastErrorCode: "stt_unavailable" }),
      "Failed after 5 attempts (stt_unavailable)",
    ],
    [job({ status: "failed", attempts: 5 }), "Failed after 5 attempts"],
    [job({ status: "succeeded" }), "Done"],
  ])("%j reads %s", (input, text) => {
    expect(describeJob(input)).toBe(text);
  });
});

describe("processingProgress", () => {
  it("keeps going while the meeting is processing and shows both jobs", () => {
    const view = processingProgress(payload({ summary: job({ status: "pending" }) }));
    expect(view.settled).toBe(false);
    expect(view.fields).toMatchObject({
      transcript: "Transcript: Running",
      summary: "Summary: Waiting to start",
      outcome: "",
    });
  });

  it("settles when the draft is ready and says how to see it", () => {
    const view = processingProgress(
      payload({ meetingStatus: "review", job: job({ status: "succeeded" }) }),
    );
    expect(view.settled).toBe(true);
    expect(view.fields["outcome"]).toMatch(/draft is ready/i);
    expect(view.fields["outcome"]).toMatch(/check again/i);
    expect(view.fields["badge"]).toBe("Draft: not published");
  });

  it("settles on failure with the reason code, never more", () => {
    const view = processingProgress(
      payload({
        meetingStatus: "failed",
        job: job({ status: "failed", attempts: 5, lastErrorCode: "stt_unavailable" }),
      }),
    );
    expect(view.settled).toBe(true);
    expect(view.fields["transcript"]).toBe("Transcript: Failed after 5 attempts (stt_unavailable)");
    expect(view.fields["outcome"]).toMatch(/did not finish/i);
    expect(view.fields["badge"]).toBe("Processing needs attention");
  });

  it("settles for any status that is no longer processing", () => {
    expect(processingProgress(payload({ meetingStatus: "published" })).settled).toBe(true);
    expect(processingProgress(payload({ meetingStatus: "capturing" })).settled).toBe(true);
  });
});

describe("processingProgress on a page that has a link to the review (#63)", () => {
  it("offers the link instead of telling the owner to check again once the draft is ready", () => {
    const view = processingProgress(
      payload({ meetingStatus: "review", job: job({ status: "succeeded" }) }),
      true,
    );
    expect(view.settled).toBe(true);
    expect(view.fields["link"]).toBe("Open the draft");
    expect(view.fields["outcome"]).toBe("Your draft is ready.");
    expect(view.fields["badge"]).toBe("Draft: not published");
  });

  it("offers the link on failure too, because the review page is where the retry is", () => {
    const view = processingProgress(
      payload({ meetingStatus: "failed", job: job({ status: "failed", attempts: 5 }) }),
      true,
    );
    expect(view.fields["link"]).toBe("See what happened and retry");
    expect(view.fields["outcome"]).toMatch(/did not finish/i);
    expect(view.fields["outcome"]).toMatch(/rough notes are kept/i);
    expect(view.fields["outcome"]).not.toMatch(/check again/i);
  });

  it("keeps the link hidden (empty) while still processing and for states with nothing to review", () => {
    expect(processingProgress(payload(), true).fields["link"]).toBe("");
    const moved = processingProgress(payload({ meetingStatus: "published" }), true);
    expect(moved.fields["link"]).toBe("");
    expect(moved.fields["outcome"]).toMatch(/check again/i);
  });

  it("says nothing about a link where the page has none (the review page itself)", () => {
    const view = processingProgress(payload({ meetingStatus: "review" }));
    expect(view.fields).not.toHaveProperty("link");
    expect(view.fields["outcome"]).toMatch(/check again/i);
  });
});

describe("reviewLinkLabel and reviewPath", () => {
  it.each([
    ["review", "Open the draft"],
    ["failed", "See what happened and retry"],
  ] as const)("%s has a link labelled %s", (status, label) => {
    expect(reviewLinkLabel(status)).toBe(label);
  });

  it.each([
    "scheduled",
    "capturing",
    "paused",
    "processing",
    "published",
    "archived",
    "deleting",
  ] as const)("%s has no link to the review", (status) => {
    expect(reviewLinkLabel(status)).toBeNull();
  });

  it("builds the path from the meeting id it is given, nothing else", () => {
    expect(reviewPath("abc-123")).toBe("/meetings/abc-123/review");
  });
});

describe("regenerationProgress", () => {
  const regen = (over: Partial<JobProgress> = {}) =>
    payload({ regeneration: { sectionId: "s1", ...job(over) } });

  it("reports the job for this section and keeps polling until it is done", () => {
    const view = regenerationProgress(regen({ status: "retrying", attempts: 2 }), "s1");
    expect(view.settled).toBe(false);
    expect(view.fields["text"]).toBe("Regeneration: Retrying (attempt 2 of 5).");
  });

  it("settles with a next step when it succeeds or fails", () => {
    const done = regenerationProgress(regen({ status: "succeeded" }), "s1");
    expect(done.settled).toBe(true);
    expect(done.fields["outcome"]).toMatch(/new draft/i);
    const failed = regenerationProgress(regen({ status: "failed", attempts: 5 }), "s1");
    expect(failed.settled).toBe(true);
    expect(failed.fields["outcome"]).toMatch(/check again/i);
  });

  it("does not report another section's regeneration", () => {
    const view = regenerationProgress(regen({ status: "succeeded" }), "other");
    expect(view.settled).toBe(false);
    expect(view.fields).toEqual({});
  });
});

describe("cardProgress", () => {
  it("announces the new state with the meeting title taken from the page", () => {
    const view = cardProgress(payload({ meetingStatus: "review" }), "Weekly sync", "m1");
    expect(view.settled).toBe(true);
    expect(view.fields).toMatchObject({
      label: "Draft ready for review",
      action: "Review note",
    });
    expect(view.announce).toBe("Weekly sync: draft ready for review.");
  });

  it("stays quiet while the meeting is still being processed", () => {
    const view = cardProgress(payload(), "Weekly sync", "m1");
    expect(view.settled).toBe(false);
    expect(view.announce).toBeNull();
  });

  it("announces a failure", () => {
    const view = cardProgress(payload({ meetingStatus: "failed" }), "Weekly sync", "m1");
    expect(view.announce).toBe("Weekly sync: needs attention: processing failed.");
  });
});

describe("deletionRowProgress", () => {
  const row = (over: Partial<Parameters<typeof deletionRowProgress>[0]> = {}) =>
    deletionRowProgress({
      status: "running",
      attempts: 1,
      maxAttempts: 5,
      nextRunAt: null,
      lastErrorCode: null,
      ...over,
    });

  it("reuses the settings wording and keeps going while in progress", () => {
    const view = row();
    expect(view.settled).toBe(false);
    expect(view.label).toBe("Deleting");
    expect(view.canRetry).toBe(false);
  });

  it("settles on done and on failed (failed offers the retry)", () => {
    expect(row({ status: "succeeded" })).toMatchObject({ settled: true, label: "Deleted" });
    expect(row({ status: "failed", attempts: 5 })).toMatchObject({
      settled: true,
      label: "Failed",
      canRetry: true,
    });
  });
});

describe("stoppedMessage", () => {
  it("tells the person what to do when live updates end without a result", () => {
    for (const reason of ["errors", "timeout", "unavailable"] as const) {
      expect(stoppedMessage(reason)).toMatch(/check again/i);
    }
  });
});

describe("payload parsing", () => {
  it("accepts what the status endpoint sends", () => {
    const body = {
      meetingStatus: "processing",
      job: { status: "running", attempts: 1, maxAttempts: 5, nextRunAt: null, lastErrorCode: null },
      summary: null,
      regeneration: null,
      chunks: { total: 1, uploaded: 1, transcribed: 0, failed: 0, purged: 0 },
    };
    expect(parseProcessingPayload(body)).toMatchObject({
      meetingStatus: "processing",
      chunks: { total: 1, uploaded: 1, transcribed: 0, failed: 0, purged: 0 },
    });
  });

  it("keeps the chunk counts, which are what the live counts are made of", () => {
    const body = {
      meetingStatus: "processing",
      job: null,
      summary: null,
      regeneration: null,
      chunks: { total: 7, uploaded: 4, transcribed: 2, failed: 1, purged: 0 },
    };
    expect(parseProcessingPayload(body)?.chunks).toEqual({
      total: 7,
      uploaded: 4,
      transcribed: 2,
      failed: 1,
      purged: 0,
    });
  });

  it("treats an answer without chunk counts as having none, and a malformed one as unusable", () => {
    const base = { meetingStatus: "processing", job: null, summary: null, regeneration: null };
    expect(parseProcessingPayload(base)?.chunks).toBeNull();
    expect(parseProcessingPayload({ ...base, chunks: "many" })).toBeNull();
    expect(parseProcessingPayload({ ...base, chunks: { total: -1 } })).toBeNull();
    expect(
      parseProcessingPayload({
        ...base,
        chunks: { total: 1.5, uploaded: 0, transcribed: 0, failed: 0, purged: 0 },
      }),
    ).toBeNull();
  });

  it.each([null, "x", 3, {}, { meetingStatus: 4 }, { meetingStatus: "processing", job: "no" }])(
    "rejects %j rather than guessing",
    (body) => {
      expect(parseProcessingPayload(body)).toBeNull();
    },
  );

  it("parses the deletions list and drops malformed rows", () => {
    const good = {
      meetingId: "m1",
      status: "pending",
      attempts: 0,
      maxAttempts: 5,
      nextRunAt: null,
      lastErrorCode: null,
    };
    expect(parseDeletionsPayload({ deletions: [good, { meetingId: 1 }] })).toEqual([good]);
    expect(parseDeletionsPayload({ nope: true })).toBeNull();
  });
});

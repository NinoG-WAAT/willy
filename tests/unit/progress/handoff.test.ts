import { describe, expect, it } from "vitest";
import {
  AUTO_OPEN_DELAY_MS,
  OPENING_ANNOUNCEMENT,
  decideAutoOpen,
  handoffProgress,
  handoffStage,
  isTypingTarget,
} from "../../../src/domain/progress/handoff";
import type {
  ChunkCounts,
  JobProgress,
  ProcessingPayload,
} from "../../../src/domain/progress/text";

const job = (over: Partial<JobProgress> = {}): JobProgress => ({
  status: "running",
  attempts: 1,
  maxAttempts: 5,
  nextRunAt: null,
  lastErrorCode: null,
  ...over,
});

const chunks = (over: Partial<ChunkCounts> = {}): ChunkCounts => ({
  total: 7,
  uploaded: 5,
  transcribed: 1,
  failed: 0,
  purged: 1,
  ...over,
});

const payload = (over: Partial<ProcessingPayload> = {}): ProcessingPayload => ({
  meetingStatus: "processing",
  job: job(),
  summary: null,
  regeneration: null,
  chunks: chunks(),
  ...over,
});

describe("handoffStage", () => {
  it.each([
    [payload(), "transcribing"],
    [payload({ job: job({ status: "pending" }) }), "transcribing"],
    [payload({ job: job({ status: "retrying", attempts: 2 }) }), "transcribing"],
    [payload({ job: null }), "transcribing"],
    [payload({ job: job({ status: "succeeded" }), summary: null }), "writing"],
    [
      payload({ job: job({ status: "succeeded" }), summary: job({ status: "running" }) }),
      "writing",
    ],
    [payload({ meetingStatus: "review" }), "ready"],
    [payload({ meetingStatus: "failed" }), "failed"],
    [payload({ meetingStatus: "published" }), "moved"],
    [payload({ meetingStatus: "capturing" }), "moved"],
  ] as const)("%j is %s", (input, stage) => {
    expect(handoffStage(input)).toBe(stage);
  });
});

describe("handoffProgress while transcribing", () => {
  it("shows real counts: parts done (transcribed or already purged) of all parts", () => {
    const view = handoffProgress(payload());
    expect(view.stage).toBe("transcribing");
    expect(view.settled).toBe(false);
    expect(view.fields["headline"]).toBe("Recording finished. Preparing the transcript.");
    expect(view.fields["transcribe"]).toBe("Transcribing: 2 of 7 parts");
    expect(view.fields["draft"]).toBe("Writing the draft: Waiting for the transcript");
    expect(view.bar).toEqual({ value: 2, max: 7 });
    expect(view.fields["link"]).toBe("");
    expect(view.fields["outcome"]).toBe("");
  });

  it("says part, not parts, for one", () => {
    const view = handoffProgress(payload({ chunks: chunks({ total: 1, transcribed: 0, purged: 0 }) }));
    expect(view.fields["transcribe"]).toBe("Transcribing: 0 of 1 part");
  });

  it("falls back to the job's own words when no part is known yet", () => {
    const view = handoffProgress(
      payload({ job: job({ status: "pending" }), chunks: chunks({ total: 0 }) }),
    );
    expect(view.fields["transcribe"]).toBe("Transcribing: Waiting to start");
    expect(view.bar).toBeNull();
    expect(handoffProgress(payload({ chunks: null })).bar).toBeNull();
  });

  it("explains a retry and parts that did not work, keeping what is done", () => {
    const view = handoffProgress(
      payload({
        job: job({ status: "retrying", attempts: 2 }),
        chunks: chunks({ failed: 1, transcribed: 3, purged: 0 }),
      }),
    );
    expect(view.fields["transcribe"]).toBe("Transcribing: 3 of 7 parts");
    expect(view.fields["note"]).toBe(
      "1 part could not be transcribed yet. Retrying automatically (attempt 2 of 5). Parts already done are kept.",
    );
  });

  it("has no note when nothing needs explaining", () => {
    expect(handoffProgress(payload()).fields["note"]).toBe("");
  });

  it("stays quiet for screen readers: counts are not announced, only stages", () => {
    expect(handoffProgress(payload()).fields["announce"]).toBe("");
  });
});

describe("handoffProgress while writing the draft", () => {
  const writing = (summary: JobProgress | null = job({ status: "running" })) =>
    payload({ job: job({ status: "succeeded" }), summary, chunks: chunks({ transcribed: 0, purged: 7 }) });

  it("shows the transcript as done and the draft as running, without a bar", () => {
    const view = handoffProgress(writing());
    expect(view.stage).toBe("writing");
    expect(view.settled).toBe(false);
    expect(view.fields["transcribe"]).toBe("Transcribing: Done, 7 parts");
    expect(view.fields["draft"]).toBe("Writing the draft: Running");
    expect(view.bar).toBeNull();
    expect(view.fields["announce"]).toBe("Transcript done. Writing the draft.");
  });

  it("calls a summary job that is not queued yet waiting, not 'not started'", () => {
    expect(handoffProgress(writing(null)).fields["draft"]).toBe("Writing the draft: Waiting to start");
  });

  it("shows a summary retry in the draft line", () => {
    const view = handoffProgress(writing(job({ status: "retrying", attempts: 3 })));
    expect(view.fields["draft"]).toBe("Writing the draft: Retrying (attempt 3 of 5)");
  });
});

describe("handoffProgress when the draft is ready", () => {
  const ready = payload({
    meetingStatus: "review",
    job: job({ status: "succeeded" }),
    summary: job({ status: "succeeded" }),
    chunks: chunks({ transcribed: 0, purged: 7 }),
  });

  it("settles with one action: Open the draft", () => {
    const view = handoffProgress(ready);
    expect(view.stage).toBe("ready");
    expect(view.settled).toBe(true);
    expect(view.fields["headline"]).toBe("Recording finished. A draft is ready for review.");
    expect(view.fields["link"]).toBe("Open the draft");
    expect(view.fields["outcome"]).toBe("Your draft is ready.");
    expect(view.fields["draft"]).toBe("Writing the draft: Done");
    expect(view.bar).toBeNull();
  });

  it("announces that the button is there, unless the page is about to open the draft", () => {
    expect(handoffProgress(ready).fields["announce"]).toBe(
      "Draft ready. Use the Open the draft button.",
    );
    const opening = handoffProgress(ready, { autoOpening: true });
    expect(opening.fields["announce"]).toBe(OPENING_ANNOUNCEMENT);
    expect(OPENING_ANNOUNCEMENT).toBe("Draft ready, opening it.");
    // The button stays either way, in case the owner is quicker or the navigation fails.
    expect(opening.fields["link"]).toBe("Open the draft");
  });
});

describe("handoffProgress when processing failed", () => {
  const failed = payload({
    meetingStatus: "failed",
    job: job({ status: "failed", attempts: 5, lastErrorCode: "stt_unavailable" }),
    chunks: chunks({ failed: 1, transcribed: 3, purged: 0 }),
  });

  it("settles with the way to the retry, the reason code and what is kept", () => {
    const view = handoffProgress(failed);
    expect(view.stage).toBe("failed");
    expect(view.settled).toBe(true);
    expect(view.fields["headline"]).toBe("Recording finished, but processing needs attention.");
    expect(view.fields["transcribe"]).toBe("Transcribing: Failed after 5 attempts (stt_unavailable)");
    expect(view.fields["note"]).toBe("1 part could not be transcribed. 3 parts are kept.");
    expect(view.fields["outcome"]).toBe("Processing did not finish. Your rough notes are kept.");
    expect(view.fields["link"]).toBe("See what happened and retry");
    expect(view.fields["announce"]).toBe(
      "Processing needs attention. Your rough notes are kept. Use the See what happened and retry button.",
    );
  });

  it("never auto-opens: the retry is the owner's call", () => {
    expect(handoffProgress(failed, { autoOpening: true }).fields["announce"]).not.toBe(
      OPENING_ANNOUNCEMENT,
    );
  });
});

describe("handoffProgress for a note that moved on", () => {
  it("settles and points at Check again", () => {
    const view = handoffProgress(payload({ meetingStatus: "published" }));
    expect(view.stage).toBe("moved");
    expect(view.settled).toBe(true);
    expect(view.fields["outcome"]).toMatch(/moved on.*check again/i);
    expect(view.fields["link"]).toBe("");
  });
});

describe("handoffProgress only uses codes and counts", () => {
  it("builds every word from the payload's numbers and codes, never from free text", () => {
    const view = handoffProgress(
      payload({ job: job({ status: "retrying", lastErrorCode: "<img src=x>" }) }),
    );
    // Retrying shows attempts only; the code appears nowhere outside the failed state, and even
    // there it is written with textContent by the page.
    expect(JSON.stringify(view.fields)).not.toContain("<img");
  });
});

describe("isTypingTarget", () => {
  it.each([
    [{ tagName: "TEXTAREA" }, true],
    [{ tagName: "INPUT", type: "text" }, true],
    [{ tagName: "INPUT", type: "search" }, true],
    [{ tagName: "INPUT", type: "email" }, true],
    [{ tagName: "INPUT", type: "password" }, true],
    [{ tagName: "INPUT", type: "" }, true],
    [{ tagName: "INPUT" }, true],
    [{ tagName: "DIV", isContentEditable: true }, true],
    [{ tagName: "SELECT" }, true],
    [{ tagName: "INPUT", type: "checkbox" }, false],
    [{ tagName: "INPUT", type: "radio" }, false],
    [{ tagName: "INPUT", type: "submit" }, false],
    [{ tagName: "INPUT", type: "button" }, false],
    [{ tagName: "BUTTON" }, false],
    [{ tagName: "A" }, false],
    [{ tagName: "BODY" }, false],
    [{ tagName: "DIV", isContentEditable: false }, false],
    [null, false],
  ] as const)("%j -> %s", (target, expected) => {
    expect(isTypingTarget(target)).toBe(expected);
  });
});

describe("decideAutoOpen", () => {
  const idle = { stage: "ready", focusInTextField: false, unsavedNotes: false, reducedMotion: false } as const;

  it("opens the draft by itself when it is ready and the owner is not typing", () => {
    expect(decideAutoOpen(idle)).toEqual({ open: true, delayMs: AUTO_OPEN_DELAY_MS, animate: true });
  });

  it("leaves time for the announcement to be heard before navigating", () => {
    expect(AUTO_OPEN_DELAY_MS).toBeGreaterThanOrEqual(1_000);
  });

  it("does not open while focus is in a text field", () => {
    expect(decideAutoOpen({ ...idle, focusInTextField: true })).toEqual({
      open: false,
      reason: "typing",
    });
  });

  it("does not open while the rough notes have changes the server may not have", () => {
    expect(decideAutoOpen({ ...idle, unsavedNotes: true })).toEqual({
      open: false,
      reason: "unsaved_notes",
    });
  });

  it("typing wins when both apply", () => {
    expect(decideAutoOpen({ ...idle, focusInTextField: true, unsavedNotes: true })).toEqual({
      open: false,
      reason: "typing",
    });
  });

  it.each(["transcribing", "writing", "failed", "moved"] as const)(
    "never opens for stage %s",
    (stage) => {
      expect(decideAutoOpen({ ...idle, stage })).toEqual({ open: false, reason: "not_ready" });
    },
  );

  it("with reduced motion it still opens (a page change is not motion) but without animation", () => {
    expect(decideAutoOpen({ ...idle, reducedMotion: true })).toEqual({
      open: true,
      delayMs: AUTO_OPEN_DELAY_MS,
      animate: false,
    });
  });
});

import { describe, expect, it } from "vitest";
import type { MeetingStatus } from "../../../src/domain/meetings/lifecycle";
import {
  STAGE_STEPS,
  STATUS_LABELS,
  headerAction,
  headerChips,
  stageFor,
  statusLabel,
} from "../../../src/domain/meetings/stage";

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

describe("statusLabel: one word per status, used by the header, the cards and the progress text", () => {
  it("has a label for every status", () => {
    for (const status of ALL) expect(statusLabel(status).length).toBeGreaterThan(0);
    expect(Object.keys(STATUS_LABELS).sort()).toEqual([...ALL].sort());
  });

  it.each([
    ["scheduled", "Scheduled"],
    ["capturing", "Recording"],
    ["paused", "Recording paused"],
    ["processing", "Processing"],
    ["review", "Draft"],
    ["published", "Published"],
    ["failed", "Needs attention"],
    ["archived", "Archived"],
  ] as const)("%s reads %s", (status, label) => {
    expect(statusLabel(status)).toBe(label);
  });

  it("never uses the word review for the draft: the status is called review, the person sees Draft", () => {
    for (const status of ALL) expect(statusLabel(status).toLowerCase()).not.toContain("review");
  });

  it("says nothing about a meeting that is being deleted", () => {
    expect(statusLabel("deleting")).toBe("Unavailable");
    expect(statusLabel("deleted")).toBe("Unavailable");
  });
});

describe("stageFor: the five steps of the stepper", () => {
  it("names the steps in lifecycle order", () => {
    expect(STAGE_STEPS.map((s) => s.label)).toEqual([
      "Scheduled",
      "Capturing",
      "Processing",
      "Draft",
      "Published",
    ]);
  });

  it.each([
    ["scheduled", 0],
    ["capturing", 1],
    ["paused", 1],
    ["processing", 2],
    ["failed", 2],
    ["review", 3],
    ["published", 4],
  ] as const)("%s is on step index %i", (status, index) => {
    const stage = stageFor(status);
    expect(stage.kind).toBe("flow");
    if (stage.kind !== "flow") return;
    expect(stage.current).toBe(index);
    expect(stage.steps).toHaveLength(5);
    expect(stage.steps.filter((s) => s.current)).toHaveLength(1);
    expect(stage.steps[index]?.current).toBe(true);
    expect(stage.steps.slice(0, index).every((s) => s.state === "done")).toBe(true);
    expect(stage.steps.slice(index + 1).every((s) => s.state === "upcoming")).toBe(true);
  });

  it("gives every step a state in words, not only a state name", () => {
    const stage = stageFor("review");
    if (stage.kind !== "flow") throw new Error("flow expected");
    expect(stage.steps.map((s) => s.stateText)).toEqual([
      "Done",
      "Done",
      "Done",
      "Current step",
      "Upcoming",
    ]);
  });

  it("marks done steps with a tick, a step that needs attention with !, the rest with their number", () => {
    const draft = stageFor("review");
    if (draft.kind !== "flow") throw new Error("flow expected");
    expect(draft.steps.map((s) => s.mark)).toEqual(["✓", "✓", "✓", "4", "5"]);
    const failed = stageFor("failed");
    if (failed.kind !== "flow") throw new Error("flow expected");
    expect(failed.steps.map((s) => s.mark)).toEqual(["✓", "✓", "!", "4", "5"]);
  });

  it("counts paused as Capturing and says it is paused", () => {
    const stage = stageFor("paused");
    if (stage.kind !== "flow") throw new Error("flow expected");
    expect(stage.steps[1]?.label).toBe("Capturing");
    expect(stage.summary).toBe("Step 2 of 5: Capturing, paused");
    expect(stage.attention).toBe(false);
  });

  it("shows failed as Needs attention on the Processing step, in text", () => {
    const stage = stageFor("failed");
    if (stage.kind !== "flow") throw new Error("flow expected");
    expect(stage.attention).toBe(true);
    const processing = stage.steps[2];
    expect(processing?.label).toBe("Processing");
    expect(processing?.state).toBe("attention");
    expect(processing?.current).toBe(true);
    expect(processing?.stateText).toBe("Needs attention");
    expect(stage.summary).toBe("Step 3 of 5: Processing, needs attention");
  });

  it("summarises the position for a phone", () => {
    const draft = stageFor("review");
    if (draft.kind !== "flow") throw new Error("flow expected");
    expect(draft.summary).toBe("Step 4 of 5: Draft");
    expect(draft.position).toBe("Step 4 of 5");
  });

  it("treats archived as its own state, outside the five steps", () => {
    expect(stageFor("archived")).toEqual({ kind: "archived", label: "Archived" });
  });

  it("has no stage for a meeting that is being deleted", () => {
    expect(stageFor("deleting")).toEqual({ kind: "gone" });
    expect(stageFor("deleted")).toEqual({ kind: "gone" });
  });
});

describe("headerAction: one primary action per stage, links to where the action lives", () => {
  const ctx = { meetingId: "m1", noteStatus: null, consentConfirmed: false } as const;

  it("live note, scheduled: start capture leads to the consent statement", () => {
    expect(headerAction("live", "scheduled", ctx)).toEqual({
      label: "Start capture",
      href: "#consent",
      emphasis: "primary",
    });
  });

  it("live note, scheduled with consent already stored: leads to the start button", () => {
    expect(headerAction("live", "scheduled", { ...ctx, consentConfirmed: true })?.href).toBe(
      "#start-button",
    );
  });

  it("live note: no lime action while recording (a state, not an invitation), paused or processing", () => {
    expect(headerAction("live", "capturing", ctx)).toBeNull();
    expect(headerAction("live", "paused", ctx)).toBeNull();
    expect(headerAction("live", "processing", ctx)).toBeNull();
  });

  it("live note: the draft and the retry live on the review page", () => {
    expect(headerAction("live", "review", ctx)).toEqual({
      label: "Open the draft",
      href: "/meetings/m1/review",
      emphasis: "primary",
    });
    expect(headerAction("live", "failed", ctx)).toEqual({
      label: "See what happened and retry",
      href: "/meetings/m1/review",
      emphasis: "primary",
    });
  });

  it("live note: a published note offers its page as a secondary link", () => {
    expect(headerAction("live", "published", ctx)).toEqual({
      label: "Open the published note",
      href: "/meetings/m1/review",
      emphasis: "secondary",
    });
  });

  it("live note: archived and deleting offer nothing", () => {
    expect(headerAction("live", "archived", ctx)).toBeNull();
    expect(headerAction("live", "deleting", ctx)).toBeNull();
    expect(headerAction("live", "deleted", ctx)).toBeNull();
  });

  it("review, draft: Publish is the primary action and leads to the publish form", () => {
    expect(headerAction("review", "review", { ...ctx, noteStatus: "draft" })).toEqual({
      label: "Publish to folder",
      href: "#publish",
      emphasis: "primary",
    });
  });

  it("review, published: reopening is secondary", () => {
    expect(headerAction("review", "published", { ...ctx, noteStatus: "published" })).toEqual({
      label: "Reopen for editing",
      href: "#publish",
      emphasis: "secondary",
    });
  });

  it("review: processing, failed (the retry button is its own panel) and archived have no header action", () => {
    expect(headerAction("review", "processing", ctx)).toBeNull();
    expect(headerAction("review", "failed", ctx)).toBeNull();
    expect(headerAction("review", "archived", ctx)).toBeNull();
  });

  it("review: a meeting in review without a draft note offers nothing to publish", () => {
    expect(headerAction("review", "review", ctx)).toBeNull();
  });
});

describe("headerChips", () => {
  const folder = { id: "f1", name: "Board updates" };
  const template = { id: "t1", name: "Customer call" };

  it("shows the folder only once the note is published into it", () => {
    expect(headerChips({ noteStatus: "published", folder, template: null })).toEqual([
      { kind: "folder", label: "Folder: Board updates", href: "/folders/f1" },
    ]);
    expect(headerChips({ noteStatus: "draft", folder, template: null })).toEqual([]);
    expect(headerChips({ noteStatus: null, folder, template: null })).toEqual([]);
  });

  it("shows the template whenever one is set, linking to it", () => {
    expect(headerChips({ noteStatus: null, folder: null, template })).toEqual([
      { kind: "template", label: "Template: Customer call", href: "/settings/templates/t1" },
    ]);
  });

  it("lists the folder before the template", () => {
    expect(headerChips({ noteStatus: "published", folder, template }).map((c) => c.kind)).toEqual([
      "folder",
      "template",
    ]);
  });

  it("shows nothing when there is nothing to show", () => {
    expect(headerChips({ noteStatus: "published", folder: null, template: null })).toEqual([]);
  });
});

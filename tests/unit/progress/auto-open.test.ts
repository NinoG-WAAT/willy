import { describe, expect, it } from "vitest";
import { AUTO_OPEN_DELAY_MS, STAYING_ANNOUNCEMENT } from "../../../src/domain/progress/handoff";
import {
  decideNow,
  scheduleAutoOpen,
  type AutoOpenDeps,
} from "../../../src/scripts/progress/auto-open";

function setup(state: Partial<ReturnType<AutoOpenDeps["readState"]>> = {}) {
  const current = { focusInTextField: false, unsavedNotes: false, reducedMotion: false, ...state };
  const log: string[] = [];
  const timers: { run: () => void; ms: number }[] = [];
  const deps: AutoOpenDeps = {
    readState: () => ({ ...current }),
    setTimer: (run, ms) => {
      timers.push({ run, ms });
      return timers.length;
    },
    navigate: () => log.push("navigate"),
    announce: (text) => log.push(`announce: ${text}`),
  };
  return { deps, current, log, timers };
}

describe("decideNow", () => {
  it("reads the page state and applies the domain rule", () => {
    expect(decideNow(setup().deps, "ready")).toMatchObject({ open: true });
    expect(decideNow(setup({ focusInTextField: true }).deps, "ready")).toMatchObject({
      open: false,
      reason: "typing",
    });
    expect(decideNow(setup({ unsavedNotes: true }).deps, "ready")).toMatchObject({
      open: false,
      reason: "unsaved_notes",
    });
    expect(decideNow(setup().deps, "failed")).toMatchObject({ open: false, reason: "not_ready" });
  });
});

describe("scheduleAutoOpen", () => {
  const open = { open: true, delayMs: AUTO_OPEN_DELAY_MS, animate: true } as const;

  it("waits for the announcement, then navigates once", () => {
    const { deps, timers, log } = setup();
    scheduleAutoOpen(deps, open);
    expect(log).toEqual([]);
    expect(timers).toHaveLength(1);
    expect(timers[0]?.ms).toBe(AUTO_OPEN_DELAY_MS);
    timers[0]?.run();
    timers[0]?.run();
    expect(log).toEqual(["navigate"]);
  });

  it("does not navigate if the owner started typing while the announcement played", () => {
    const { deps, current, timers, log } = setup();
    scheduleAutoOpen(deps, open);
    current.focusInTextField = true;
    timers[0]?.run();
    expect(log).toEqual([`announce: ${STAYING_ANNOUNCEMENT}`]);
  });

  it("does not navigate if notes became unsaved in the meantime", () => {
    const { deps, current, timers, log } = setup();
    scheduleAutoOpen(deps, open);
    current.unsavedNotes = true;
    timers[0]?.run();
    expect(log).toEqual([`announce: ${STAYING_ANNOUNCEMENT}`]);
  });

  it("does nothing at all when the decision was not to open", () => {
    const { deps, timers, log } = setup();
    scheduleAutoOpen(deps, { open: false, reason: "typing" });
    expect(timers).toHaveLength(0);
    expect(log).toEqual([]);
  });
});

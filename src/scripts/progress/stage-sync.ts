import type { MeetingStatus } from "../../domain/meetings/lifecycle";
import { stageFor, statusLabel } from "../../domain/meetings/stage";

/**
 * Keeps the meeting header (stepper, status word, "Not published" tag) in step with the status the
 * polling script just read, so a hand-off that settles in place does not leave the header saying
 * Processing. The words and states come from the same domain functions the server render uses, so
 * a live update and a reload agree. It only writes text and attributes into the markup the server
 * rendered; without it the header is still correct after a reload.
 */
export function syncStage(status: MeetingStatus, root: ParentNode = document): void {
  const stage = stageFor(status);
  for (const pill of root.querySelectorAll<HTMLElement>("[data-stage-label]")) {
    pill.textContent = statusLabel(status);
    pill.dataset["status"] = status;
  }
  for (const flag of root.querySelectorAll<HTMLElement>("[data-not-published]")) {
    flag.hidden = status !== "review";
  }
  if (stage.kind !== "flow") return;
  for (const summary of root.querySelectorAll<HTMLElement>("[data-stage-summary]")) {
    summary.textContent = stage.summary;
  }
  for (const item of root.querySelectorAll<HTMLElement>("[data-stepper] [data-step]")) {
    const step = stage.steps.find((candidate) => candidate.key === item.dataset["step"]);
    if (!step) continue;
    item.dataset["state"] = step.state;
    if (step.current) item.setAttribute("aria-current", "step");
    else item.removeAttribute("aria-current");
    const mark = item.querySelector<HTMLElement>("[data-step-mark]");
    if (mark) mark.textContent = step.mark;
    const state = item.querySelector<HTMLElement>("[data-step-state]");
    if (state) {
      state.textContent = step.stateText;
      // A step that needs attention says so on screen; the others only to a screen reader.
      state.classList.toggle("sr-only", step.state !== "attention");
    }
  }
}

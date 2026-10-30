import {
  STAYING_ANNOUNCEMENT,
  decideAutoOpen,
  type AutoOpenDecision,
  type HandoffStage,
} from "../../domain/progress/handoff";

/**
 * The browser side of "open the draft by itself". The rule is in src/domain/progress/handoff.ts;
 * this reads the page, asks the rule, and navigates after the announcement has had time to be
 * heard. Dependencies are injected so it can be tested without a browser. It never moves focus.
 */

export interface AutoOpenState {
  focusInTextField: boolean;
  unsavedNotes: boolean;
  reducedMotion: boolean;
}

export interface AutoOpenDeps {
  readState: () => AutoOpenState;
  setTimer: (run: () => void, ms: number) => unknown;
  /** Goes to the draft. The address is fixed by the page, never taken from a response. */
  navigate: () => void;
  /** Writes into the live region. */
  announce: (text: string) => void;
}

export function decideNow(deps: AutoOpenDeps, stage: HandoffStage): AutoOpenDecision {
  return decideAutoOpen({ stage, ...deps.readState() });
}

/**
 * After the delay the rule is asked again: the owner may have started typing while the
 * announcement played, and then the page stays and says where the button is.
 */
export function scheduleAutoOpen(deps: AutoOpenDeps, decision: AutoOpenDecision): void {
  if (!decision.open) return;
  let done = false;
  deps.setTimer(() => {
    if (done) return;
    done = true;
    if (decideNow(deps, "ready").open) deps.navigate();
    else deps.announce(STAYING_ANNOUNCEMENT);
  }, decision.delayMs);
}

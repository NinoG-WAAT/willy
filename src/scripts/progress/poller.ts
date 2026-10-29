import { POLL, nextPollDelayMs } from "../../domain/progress/poll-schedule";
import type { StopReason } from "../../domain/progress/text";

export type PollStopReason = StopReason;

export interface PollReply {
  status: number;
  retryAfterSeconds: number | null;
  body: unknown;
}

export interface PollerDeps {
  url: string;
  /** One GET. Rejects on network errors; resolves with the HTTP status otherwise. */
  fetchJson: (url: string) => Promise<PollReply>;
  setTimer: (run: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  now: () => number;
  /** In [0, 1). */
  random: () => number;
  isHidden: () => boolean;
  onVisibilityChange: (listener: () => void) => void;
  /** Shows an answer. Null means the answer was not usable (counted as a failed poll). */
  render: (body: unknown) => { settled: boolean } | null;
  onStop: (reason: PollStopReason) => void;
}

/**
 * Polls one status URL until the job settles. Waits before the first request (the server just
 * rendered this state), backs off while nothing changes, resets on news, honours 429 Retry-After,
 * does not request at all while the tab is hidden (one check when it is shown again), and gives
 * up on repeated failures or after a total time budget. It never throws: the page keeps working
 * as a plain server-rendered page with its "Check again" link.
 */
export function createPoller(deps: PollerDeps) {
  const startedAt = deps.now();
  let timer: unknown = null;
  let streak = 0;
  let errors = 0;
  let last: string | null = null;
  let running = false;
  let waitingForVisible = false;
  const isRunning = (): boolean => running;
  let inFlight = false;

  const schedule = (retryAfterSeconds: number | null = null): void => {
    if (!running) return;
    timer = deps.setTimer(
      () => {
        timer = null;
        void poll();
      },
      nextPollDelayMs(streak, retryAfterSeconds, deps.random()),
    );
  };

  const finish = (reason: PollStopReason): void => {
    running = false;
    if (timer !== null) deps.clearTimer(timer);
    timer = null;
    deps.onStop(reason);
  };

  const failed = (retryAfterSeconds: number | null): void => {
    errors += 1;
    streak += 1;
    if (errors >= POLL.maxConsecutiveErrors) finish("errors");
    else schedule(retryAfterSeconds);
  };

  const accept = (reply: PollReply | null): void => {
    if (reply === null) {
      failed(null);
    } else if (reply.status === 401 || reply.status === 404) {
      finish("unavailable");
    } else if (reply.status !== 200) {
      failed(reply.status === 429 ? reply.retryAfterSeconds : null);
    } else {
      const shown = deps.render(reply.body);
      if (shown === null) {
        failed(null);
        return;
      }
      errors = 0;
      const snapshot = JSON.stringify(reply.body);
      streak = snapshot === last ? streak + 1 : 0;
      last = snapshot;
      if (shown.settled) finish("settled");
      else schedule();
    }
  };

  async function poll(): Promise<void> {
    if (!running || inFlight) return;
    if (deps.now() - startedAt >= POLL.maxTotalMs) {
      finish("timeout");
      return;
    }
    if (deps.isHidden()) {
      // Nothing is looking at the page: wait for it to be shown instead of polling.
      waitingForVisible = true;
      return;
    }
    inFlight = true;
    const reply = await deps.fetchJson(deps.url).catch(() => null);
    inFlight = false;
    // stop() may have been called while the request was out: a late answer is dropped.
    if (isRunning()) accept(reply);
  }

  return {
    start(): void {
      if (running) return;
      running = true;
      deps.onVisibilityChange(() => {
        if (running && waitingForVisible && !deps.isHidden()) {
          waitingForVisible = false;
          void poll();
        }
      });
      schedule();
    },
    stop(): void {
      running = false;
      if (timer !== null) deps.clearTimer(timer);
      timer = null;
    },
  };
}

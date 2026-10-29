import { describe, expect, it } from "vitest";
import { POLL } from "../../../src/domain/progress/poll-schedule";
import {
  createPoller,
  type PollReply,
  type PollStopReason,
} from "../../../src/scripts/progress/poller";

type Reply = PollReply | "network-error";

/** A manual clock and fake browser: tests step time and visibility by hand, never sleep. */
function setup(replies: Reply[], opts: { hidden?: boolean; settleOn?: (body: unknown) => boolean } = {}) {
  let now = 0;
  let hidden = opts.hidden ?? false;
  let visibilityListener: (() => void) | null = null;
  const timers: { at: number; run: () => void; id: number }[] = [];
  let nextId = 1;
  const calls: string[] = [];
  const rendered: unknown[] = [];
  const stops: PollStopReason[] = [];
  let i = 0;

  const poller = createPoller({
    url: "/api/x/status",
    fetchJson: (url) => {
      calls.push(url);
      const reply = replies[Math.min(i++, replies.length - 1)];
      if (reply === undefined || reply === "network-error") return Promise.reject(new Error("off"));
      return Promise.resolve(reply);
    },
    setTimer: (run, ms) => {
      const id = nextId++;
      timers.push({ at: now + ms, run, id });
      return id;
    },
    clearTimer: (id) => {
      const at = timers.findIndex((t) => t.id === id);
      if (at >= 0) timers.splice(at, 1);
    },
    now: () => now,
    random: () => 0,
    isHidden: () => hidden,
    onVisibilityChange: (listener) => {
      visibilityListener = listener;
    },
    render: (body) => {
      rendered.push(body);
      // Anything that is not an object stands for a payload the page cannot use.
      return typeof body === "object" ? { settled: opts.settleOn ? opts.settleOn(body) : false } : null;
    },
    onStop: (reason) => stops.push(reason),
  });

  /** Fires the earliest timer and lets the poll it started finish. */
  async function tick(): Promise<number> {
    timers.sort((a, b) => a.at - b.at);
    const next = timers.shift();
    if (!next) throw new Error("no timer is scheduled");
    now = next.at;
    next.run();
    await flush();
    return now;
  }
  const flush = async (): Promise<void> => {
    for (let n = 0; n < 5; n++) await Promise.resolve();
  };
  return {
    poller,
    calls,
    rendered,
    stops,
    timers,
    tick,
    flush,
    setHidden(value: boolean) {
      hidden = value;
      visibilityListener?.();
    },
    advance(ms: number) {
      now += ms;
    },
  };
}

const ok = (body: unknown): PollReply => ({ status: 200, retryAfterSeconds: null, body });

describe("poller", () => {
  it("waits before the first request: the page was just rendered with this state", () => {
    const t = setup([ok({ n: 1 })]);
    t.poller.start();
    expect(t.calls).toEqual([]);
    expect(t.timers).toHaveLength(1);
  });

  it("renders each answer and keeps polling while it is not settled", async () => {
    const t = setup([ok({ n: 1 }), ok({ n: 2 })]);
    t.poller.start();
    await t.tick();
    await t.tick();
    expect(t.rendered).toEqual([{ n: 1 }, { n: 2 }]);
    expect(t.timers).toHaveLength(1);
    expect(t.stops).toEqual([]);
  });

  it("stops on a terminal state and schedules nothing more", async () => {
    const t = setup([ok({ done: false }), ok({ done: true })], {
      settleOn: (b) => (b as { done: boolean }).done,
    });
    t.poller.start();
    await t.tick();
    await t.tick();
    expect(t.timers).toHaveLength(0);
    expect(t.stops).toEqual(["settled"]);
    expect(t.calls).toHaveLength(2);
  });

  it("backs off while nothing changes and starts over when something does", async () => {
    const t = setup([ok({ n: 1 }), ok({ n: 1 }), ok({ n: 1 }), ok({ n: 2 })]);
    t.poller.start();
    const times: number[] = [];
    for (let n = 0; n < 4; n++) times.push(await t.tick());
    const gaps = times.map((time, n) => time - (times[n - 1] ?? 0));
    // first poll after the base delay; then the gap grows twice (no news); a change resets it
    expect(gaps[1] ?? 0).toBeGreaterThan(gaps[0] ?? 0);
    expect(gaps[2] ?? 0).toBeGreaterThan(gaps[1] ?? 0);
    const afterChange = t.timers[0];
    expect((afterChange?.at ?? 0) - (times[3] ?? 0)).toBe(gaps[0]);
  });

  it("does not request while the tab is hidden, and checks once when it is shown again", async () => {
    const t = setup([ok({ n: 1 })], { hidden: true });
    t.poller.start();
    await t.tick();
    expect(t.calls).toEqual([]);
    expect(t.timers).toHaveLength(0);
    t.setHidden(false);
    await t.flush();
    expect(t.calls).toHaveLength(1);
    expect(t.timers).toHaveLength(1);
  });

  it("pauses when the tab is hidden between polls", async () => {
    const t = setup([ok({ n: 1 }), ok({ n: 2 })]);
    t.poller.start();
    await t.tick();
    t.setHidden(true);
    await t.tick();
    expect(t.calls).toHaveLength(1);
    expect(t.timers).toHaveLength(0);
  });

  it("stops quietly when the session is gone or the meeting is not there", async () => {
    for (const status of [401, 404]) {
      const t = setup([{ status, retryAfterSeconds: null, body: null }]);
      t.poller.start();
      await t.tick();
      expect(t.stops).toEqual(["unavailable"]);
      expect(t.timers).toHaveLength(0);
      expect(t.rendered).toEqual([]);
    }
  });

  it("honours Retry-After on 429 and carries on", async () => {
    const t = setup([{ status: 429, retryAfterSeconds: 60, body: null }, ok({ n: 1 })]);
    t.poller.start();
    const first = await t.tick();
    const next = t.timers[0];
    expect((next?.at ?? 0) - first).toBeGreaterThanOrEqual(60_000);
    expect(t.stops).toEqual([]);
  });

  it("gives up after repeated failures, telling the caller why", async () => {
    const t = setup(["network-error", { status: 503, retryAfterSeconds: null, body: null }]);
    t.poller.start();
    for (let n = 0; n < POLL.maxConsecutiveErrors; n++) await t.tick();
    expect(t.stops).toEqual(["errors"]);
    expect(t.timers).toHaveLength(0);
  });

  it("a good answer clears the error streak", async () => {
    const t = setup(["network-error", "network-error", ok({ n: 1 }), "network-error"]);
    t.poller.start();
    for (let n = 0; n < 6; n++) await t.tick();
    expect(t.stops).toEqual([]);
  });

  it("treats an answer that cannot be rendered as an error, not as success", async () => {
    const t = setup([ok("garbage")]);
    t.poller.start();
    for (let n = 0; n < POLL.maxConsecutiveErrors; n++) await t.tick();
    expect(t.stops).toEqual(["errors"]);
  });

  it("stops after the total time budget so a stuck job is not polled forever", async () => {
    const t = setup([ok({ n: 1 })]);
    t.poller.start();
    await t.tick();
    t.advance(POLL.maxTotalMs);
    await t.tick();
    expect(t.stops).toEqual(["timeout"]);
    expect(t.timers).toHaveLength(0);
  });

  it("stop() cancels the pending timer and ignores late answers", async () => {
    const t = setup([ok({ n: 1 })]);
    t.poller.start();
    t.poller.stop();
    expect(t.timers).toHaveLength(0);
    expect(t.calls).toEqual([]);
  });
});

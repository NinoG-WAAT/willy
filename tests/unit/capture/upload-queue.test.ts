import { describe, expect, it } from "vitest";
import {
  createUploadQueue,
  type UploadQueueEvent,
} from "../../../src/scripts/capture/upload-queue";

type Reply = { status: number; headers?: Record<string, string>; error?: string } | "network-error";

function setup(replies: Reply[], options: { maxAttempts?: number } = {}) {
  const calls: { url: string; bytes: number; headers: Record<string, string> }[] = [];
  const sleeps: number[] = [];
  const events: UploadQueueEvent[] = [];
  let i = 0;
  const queue = createUploadQueue({
    upload: (url, body, headers) => {
      calls.push({ url, bytes: body.size, headers });
      const reply = replies[Math.min(i++, replies.length - 1)];
      if (reply === undefined || reply === "network-error")
        return Promise.reject(new Error("offline"));
      return Promise.resolve({
        status: reply.status,
        retryAfterSeconds: reply.headers?.["Retry-After"]
          ? Number(reply.headers["Retry-After"])
          : null,
        error: reply.error ?? null,
      });
    },
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    random: () => 0,
    onEvent: (e) => events.push(e),
    baseMs: 100,
    capMs: 1000,
    maxAttempts: options.maxAttempts ?? 5,
    endpoint: (seq, durationMs) =>
      `/api/meetings/m1/chunks?seq=${String(seq)}&durationMs=${String(durationMs)}`,
    headers: { "X-CSRF-Token": "t" },
  });
  return { queue, calls, sleeps, events };
}

const blob = (n = 10) => new Blob([new Uint8Array(n)], { type: "audio/webm" });

describe("upload queue", () => {
  it("uploads a chunk with its sequence number, duration, content type and CSRF header", async () => {
    const { queue, calls } = setup([{ status: 201 }]);
    queue.add(3, blob(), 10_000);
    await queue.idle();
    expect(calls).toEqual([
      {
        url: "/api/meetings/m1/chunks?seq=3&durationMs=10000",
        bytes: 10,
        headers: { "X-CSRF-Token": "t", "Content-Type": "audio/webm" },
      },
    ]);
    expect(queue.state()).toMatchObject({ pending: 0, failed: [], uploaded: 1 });
  });

  it("treats a replay (200) as success", async () => {
    const { queue } = setup([{ status: 200 }]);
    queue.add(0, blob(), 1000);
    await queue.idle();
    expect(queue.state().uploaded).toBe(1);
  });

  it("retries network errors and 5xx with capped backoff, then succeeds, losing nothing", async () => {
    const { queue, sleeps, calls } = setup(["network-error", { status: 503 }, { status: 201 }]);
    queue.add(0, blob(), 1000);
    await queue.idle();
    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([50, 100]);
    expect(queue.state()).toMatchObject({ pending: 0, uploaded: 1, failed: [] });
  });

  it("reports the problem while retrying so the screen can say audio is waiting", async () => {
    const { queue, events } = setup(["network-error", { status: 201 }]);
    queue.add(0, blob(), 1000);
    await queue.idle();
    expect(events.map((e) => e.kind)).toEqual(["retrying", "uploaded"]);
  });

  it("honours Retry-After on 429", async () => {
    const { queue, sleeps } = setup([
      { status: 429, headers: { "Retry-After": "7" } },
      { status: 201 },
    ]);
    queue.add(0, blob(), 1000);
    await queue.idle();
    expect(sleeps).toEqual([7000]);
  });

  it("gives up on a permanent rejection without retrying and keeps it for the owner to see", async () => {
    const { queue, calls } = setup([{ status: 413 }]);
    queue.add(0, blob(), 1000);
    await queue.idle();
    expect(calls).toHaveLength(1);
    expect(queue.state().failed).toEqual([{ seq: 0, status: 413 }]);
  });

  it("stops everything when the meeting is no longer capturing (409)", async () => {
    const { queue, events } = setup([{ status: 409 }, { status: 201 }]);
    queue.add(0, blob(), 1000);
    queue.add(1, blob(), 1000);
    await queue.idle();
    expect(events.some((e) => e.kind === "closed")).toBe(true);
    expect(queue.state().uploaded).toBe(0);
  });

  // Issue #65. A reload while a chunk is on its way leaves the dying page's upload and the new
  // page's first chunk with the same sequence number (the new page numbers from what the server
  // had stored at render time). The server answers 409 chunk_conflict. That is not "capture has
  // ended": the new audio must be kept and uploaded under the next free number.
  describe("409 chunk_conflict (the sequence number is taken by different audio)", () => {
    const conflict: Reply = { status: 409, error: "chunk_conflict" };
    const seqOf = (url: string): string | undefined => /seq=(\d+)/.exec(url)?.[1];

    it("uploads the chunk under the next sequence number instead of closing the capture", async () => {
      const { queue, calls, events } = setup([conflict, { status: 201 }]);
      queue.add(1, blob(), 1500);
      await queue.idle();
      expect(calls.map((c) => c.url)).toEqual([
        "/api/meetings/m1/chunks?seq=1&durationMs=1500",
        "/api/meetings/m1/chunks?seq=2&durationMs=1500",
      ]);
      expect(events).toContainEqual({ kind: "renumbered", from: 1, to: 2 });
      expect(events.some((e) => e.kind === "closed")).toBe(false);
      expect(queue.state()).toMatchObject({ uploaded: 1, pending: 0, closed: false, failed: [] });
    });

    it("keeps looking for a free number when several are taken", async () => {
      const { queue, calls } = setup([conflict, conflict, { status: 201 }]);
      queue.add(4, blob(), 1000);
      await queue.idle();
      expect(calls.map((c) => seqOf(c.url))).toEqual(["4", "5", "6"]);
      expect(queue.state().uploaded).toBe(1);
    });

    it("keeps the audio order: a later chunk is not sent before the renumbered one", async () => {
      const { queue, calls } = setup([conflict, { status: 201 }, { status: 201 }]);
      queue.add(1, blob(1), 1000);
      queue.add(2, blob(2), 1000);
      await queue.idle();
      // Chunk 1 became 2 (this stub accepts it). Against a real server chunk 2 would now
      // conflict with it and move on in turn; either way nothing is lost and order is kept.
      expect(calls.map((c) => [seqOf(c.url), c.bytes])).toEqual([
        ["1", 1],
        ["2", 1],
        ["2", 2],
      ]);
      expect(queue.state().uploaded).toBe(2);
    });

    it("gives up visibly (rejected, kept in failed) after too many conflicts", async () => {
      const { queue, events } = setup([conflict]);
      queue.add(0, blob(), 1000);
      await queue.idle();
      expect(events.some((e) => e.kind === "rejected")).toBe(true);
      expect(queue.state().failed).toHaveLength(1);
      expect(queue.state().closed).toBe(false);
    });
  });

  it("only meeting_not_capturing means the capture ended", async () => {
    const { queue, events } = setup([{ status: 409, error: "meeting_not_capturing" }]);
    queue.add(0, blob(), 1000);
    await queue.idle();
    expect(events.some((e) => e.kind === "closed")).toBe(true);
    expect(queue.state().closed).toBe(true);
  });

  it("after maxAttempts the chunk is stalled, not dropped", async () => {
    const { queue, calls } = setup(["network-error"], { maxAttempts: 3 });
    queue.add(0, blob(), 1000);
    await queue.idle();
    expect(calls).toHaveLength(3);
    expect(queue.state()).toMatchObject({ pending: 0, stalled: 1 });
  });

  it("retryStalled re-queues stalled chunks and uploads them", async () => {
    const replies: Reply[] = ["network-error", "network-error", { status: 201 }];
    const { queue, calls } = setup(replies, { maxAttempts: 2 });
    queue.add(0, blob(), 1000);
    await queue.idle();
    expect(queue.state().stalled).toBe(1);
    queue.retryStalled();
    await queue.idle();
    expect(calls).toHaveLength(3);
    expect(queue.state()).toMatchObject({ stalled: 0, uploaded: 1 });
  });

  it("never queues the same sequence number twice", async () => {
    const { queue, calls } = setup([{ status: 201 }]);
    queue.add(0, blob(), 1000);
    queue.add(0, blob(), 1000);
    await queue.idle();
    expect(calls).toHaveLength(1);
  });

  it("uploads in sequence order even if chunks are added while another is in flight", async () => {
    const { queue, calls } = setup([{ status: 201 }]);
    queue.add(0, blob(1), 1000);
    queue.add(1, blob(2), 1000);
    queue.add(2, blob(3), 1000);
    await queue.idle();
    expect(calls.map((c) => c.bytes)).toEqual([1, 2, 3]);
  });
});

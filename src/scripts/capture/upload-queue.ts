export type UploadQueueEvent =
  | { kind: "retrying"; seq: number; attempt: number; delayMs: number }
  | { kind: "uploaded"; seq: number }
  | { kind: "rejected"; seq: number; status: number }
  | { kind: "stalled"; seq: number }
  /** The sequence number was taken by different audio, so the chunk moved to the next free one. */
  | { kind: "renumbered"; from: number; to: number }
  /** The server says the meeting is no longer capturing: nothing further can be accepted. */
  | { kind: "closed" };

export interface UploadQueueState {
  /** Chunks waiting or in flight. */
  pending: number;
  uploaded: number;
  /** Retries exhausted: kept in memory so the owner can retry; never silently dropped. */
  stalled: number;
  /** Permanently rejected by the server (bad type, too large, conflict). */
  failed: { seq: number; status: number }[];
  closed: boolean;
}

export interface UploadQueueOptions {
  /** One upload attempt. Rejects (throws) on network errors; resolves with the HTTP status. */
  upload: (
    url: string,
    body: Blob,
    headers: Record<string, string>,
  ) => Promise<{
    status: number;
    retryAfterSeconds: number | null;
    /** The server's error code (`meeting_not_capturing`, `chunk_conflict`), when it sent one. */
    error?: string | null;
  }>;
  sleep: (ms: number) => Promise<void>;
  /** In [0, 1). */
  random: () => number;
  onEvent: (event: UploadQueueEvent) => void;
  endpoint: (seq: number, durationMs: number) => string;
  headers: Record<string, string>;
  baseMs: number;
  capMs: number;
  maxAttempts: number;
}

interface Item {
  seq: number;
  blob: Blob;
  durationMs: number;
  attempts: number;
  /** How often the sequence number was taken by other audio and the chunk moved on. */
  renumbers: number;
}

/** A taken number means a dying page's upload landed first, so one or two moves are normal. */
const MAX_RENUMBERS = 10;

/** Same equal-jitter backoff as the server's retry policy (src/domain/platform/backoff.ts). */
function backoff(retryNumber: number, baseMs: number, capMs: number, random: number): number {
  const exp = Math.min(capMs, baseMs * 2 ** (retryNumber - 1));
  return Math.floor(exp / 2 + random * (exp / 2));
}

/**
 * Uploads recorded chunks in order, one at a time, retrying network errors, 5xx and 429 with
 * capped backoff. A chunk is only forgotten once the server confirmed it (201 or the idempotent
 * replay 200); permanent rejections are reported, and chunks that run out of attempts are kept
 * as `stalled` so the screen can offer a retry. Nothing here ever discards audio silently.
 */
export function createUploadQueue(options: UploadQueueOptions) {
  const queue: Item[] = [];
  const known = new Set<number>();
  const stalled: Item[] = [];
  const failed: { seq: number; status: number }[] = [];
  let uploaded = 0;
  let closed = false;
  let inFlight: Item | null = null;
  let running: Promise<void> | null = null;

  async function sendOne(item: Item): Promise<void> {
    for (;;) {
      item.attempts += 1;
      let status: number;
      let retryAfter: number | null = null;
      let errorCode: string | null = null;
      try {
        const reply = await options.upload(options.endpoint(item.seq, item.durationMs), item.blob, {
          ...options.headers,
          "Content-Type": item.blob.type || "audio/webm",
        });
        status = reply.status;
        retryAfter = reply.retryAfterSeconds;
        errorCode = reply.error ?? null;
      } catch {
        status = 0; // offline or connection dropped: transient
      }

      if (status === 200 || status === 201) {
        uploaded += 1;
        inFlight = null;
        options.onEvent({ kind: "uploaded", seq: item.seq });
        return;
      }
      if (status === 409 && errorCode === "chunk_conflict") {
        // Issue #65: after a reload the new page numbers its chunks from what the server had
        // stored when it rendered, which can miss the dying page's last upload. The server then
        // holds different audio under our number. The capture is still open: keep this audio
        // under the next number instead of treating the conflict as the end of the capture.
        if (item.renumbers >= MAX_RENUMBERS) {
          failed.push({ seq: item.seq, status });
          inFlight = null;
          options.onEvent({ kind: "rejected", seq: item.seq, status });
          return;
        }
        item.renumbers += 1;
        const from = item.seq;
        item.seq += 1;
        item.attempts = 0;
        options.onEvent({ kind: "renumbered", from, to: item.seq });
        continue;
      }
      if (status === 409) {
        closed = true;
        inFlight = null;
        options.onEvent({ kind: "closed" });
        return;
      }
      const transient = status === 0 || status === 429 || status >= 500;
      if (!transient) {
        failed.push({ seq: item.seq, status });
        inFlight = null;
        options.onEvent({ kind: "rejected", seq: item.seq, status });
        return;
      }
      if (item.attempts >= options.maxAttempts) {
        stalled.push(item);
        inFlight = null;
        options.onEvent({ kind: "stalled", seq: item.seq });
        return;
      }
      const delayMs =
        status === 429 && retryAfter !== null
          ? retryAfter * 1000
          : backoff(item.attempts, options.baseMs, options.capMs, options.random());
      options.onEvent({ kind: "retrying", seq: item.seq, attempt: item.attempts, delayMs });
      await options.sleep(delayMs);
    }
  }

  async function drain(): Promise<void> {
    while (queue.length > 0 && !closed) {
      queue.sort((a, b) => a.seq - b.seq);
      const item = queue.shift();
      if (!item) break;
      inFlight = item;
      await sendOne(item);
      inFlight = null;
    }
  }

  function kick(): void {
    running ??= drain().finally(() => {
      running = null;
      if (queue.length > 0 && !closed) kick();
    });
  }

  return {
    add(seq: number, blob: Blob, durationMs: number): void {
      if (known.has(seq)) return;
      known.add(seq);
      queue.push({ seq, blob, durationMs, attempts: 0, renumbers: 0 });
      kick();
    },
    /** Resolves when nothing is in flight or waiting (stalled chunks do not block it). */
    async idle(): Promise<void> {
      while (running) await running;
    },
    retryStalled(): void {
      for (const item of stalled.splice(0)) {
        item.attempts = 0;
        queue.push(item);
      }
      kick();
    },
    state(): UploadQueueState {
      return {
        pending: queue.length + (inFlight ? 1 : 0),
        uploaded,
        stalled: stalled.length,
        failed: [...failed],
        closed,
      };
    },
  };
}

export type UploadQueue = ReturnType<typeof createUploadQueue>;

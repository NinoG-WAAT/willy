import { describe, expect, it } from "vitest";
import { createFakeTranscriber } from "../../../src/adapters/stt/fake-transcriber";
import { createRetryingTranscriber } from "../../../src/adapters/stt/retrying-transcriber";

const policy = { maxAttempts: 3, baseMs: 100, capMs: 1000 };
const audio = new Uint8Array([1]);
const req = { chunkId: "c1", audio, contentType: "audio/webm" };

function build() {
  const fake = createFakeTranscriber();
  const sleeps: number[] = [];
  const transcriber = createRetryingTranscriber(fake, {
    policy,
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    random: () => 0,
  });
  return { fake, sleeps, transcriber };
}

describe("retrying transcriber", () => {
  it("passes success straight through", async () => {
    const { fake, transcriber } = build();
    expect((await transcriber.transcribe(req)).ok).toBe(true);
    expect(fake.calls).toHaveLength(1);
  });

  it("retries transient failures with capped exponential backoff, then succeeds", async () => {
    const { fake, sleeps, transcriber } = build();
    fake.script.failOnChunk("c1", "unavailable", 2);
    expect((await transcriber.transcribe(req)).ok).toBe(true);
    expect(fake.calls).toHaveLength(3);
    expect(sleeps).toEqual([50, 100]);
  });

  it("gives up after the maximum attempts and returns the last error (never swallowed)", async () => {
    const { fake, transcriber } = build();
    fake.script.failOnChunk("c1", "timeout", 10);
    const result = await transcriber.transcribe(req);
    expect(result).toMatchObject({ ok: false, error: { kind: "timeout" } });
    expect(fake.calls).toHaveLength(3);
  });

  it("does not retry permanent rejections", async () => {
    const { fake, sleeps, transcriber } = build();
    fake.script.failOnChunk("c1", "rejected", 10);
    const result = await transcriber.transcribe(req);
    expect(result).toMatchObject({ ok: false, error: { kind: "rejected", retryable: false } });
    expect(fake.calls).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  it("retries one chunk without touching others (partial failure mid-stream)", async () => {
    const { fake, transcriber } = build();
    fake.script.failOnChunk("c2", "rejected", 10);
    const outcomes = [];
    for (const id of ["c1", "c2", "c3"]) {
      outcomes.push((await transcriber.transcribe({ ...req, chunkId: id })).ok);
    }
    expect(outcomes).toEqual([true, false, true]);
  });
});

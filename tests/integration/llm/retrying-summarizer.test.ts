import { describe, expect, it } from "vitest";
import { createFakeSummarizer } from "../../../src/adapters/llm/fake-summarizer";
import { createRetryingSummarizer } from "../../../src/adapters/llm/retrying-summarizer";
import { goodOutput, sampleInput } from "./summarizer.contract";

const policy = { maxAttempts: 3, baseMs: 100, capMs: 1000 };

function build() {
  const fake = createFakeSummarizer();
  const sleeps: number[] = [];
  const summarizer = createRetryingSummarizer(fake, {
    policy,
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    random: () => 0,
  });
  return { fake, sleeps, summarizer };
}

describe("retrying summarizer", () => {
  it("passes success through without sleeping", async () => {
    const { fake, sleeps, summarizer } = build();
    fake.script.respondOnce(goodOutput);
    expect((await summarizer.summarize(sampleInput())).ok).toBe(true);
    expect(fake.calls).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  it("retries transient failures with capped exponential backoff, then succeeds", async () => {
    const { fake, sleeps, summarizer } = build();
    fake.script.failOnce("unavailable");
    fake.script.failOnce("rate_limited");
    expect((await summarizer.summarize(sampleInput())).ok).toBe(true);
    expect(fake.calls).toHaveLength(3);
    expect(sleeps).toEqual([50, 100]);
  });

  it("retries an invalid model answer (the model may do better next time)", async () => {
    const { fake, summarizer } = build();
    fake.script.respondOnce({ sections: "garbage" });
    fake.script.respondOnce(goodOutput);
    expect((await summarizer.summarize(sampleInput())).ok).toBe(true);
    expect(fake.calls).toHaveLength(2);
  });

  it("gives up after the maximum attempts and returns the last error", async () => {
    const { fake, summarizer } = build();
    for (let i = 0; i < 5; i++) fake.script.failOnce("timeout");
    expect(await summarizer.summarize(sampleInput())).toMatchObject({
      ok: false,
      error: { kind: "timeout" },
    });
    expect(fake.calls).toHaveLength(3);
  });

  it("does not retry permanent rejections", async () => {
    const { fake, sleeps, summarizer } = build();
    fake.script.failOnce("rejected");
    expect(await summarizer.summarize(sampleInput())).toMatchObject({
      ok: false,
      error: { kind: "rejected", retryable: false },
    });
    expect(fake.calls).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { createFakeTranscriber } from "../../../src/adapters/stt/fake-transcriber";
import { transcriberContract } from "./transcriber.contract";

transcriberContract("fake", () => {
  const fake = createFakeTranscriber();
  return {
    transcriber: fake,
    respondWith: (utterances) => {
      fake.script.respondOnce(utterances);
    },
    failNext: (kind) => {
      fake.script.failOnce(kind);
    },
  };
});

describe("fake transcriber specifics", () => {
  const audio = new Uint8Array([9, 9]);

  it("produces deterministic text from the chunk id when nothing is scripted", async () => {
    const fake = createFakeTranscriber();
    const a = await fake.transcribe({ chunkId: "m1-c0", audio, contentType: "audio/webm" });
    const b = await fake.transcribe({ chunkId: "m1-c0", audio, contentType: "audio/webm" });
    const other = await fake.transcribe({ chunkId: "m1-c1", audio, contentType: "audio/webm" });
    expect(a).toEqual(b);
    expect(a).not.toEqual(other);
    expect(a.ok && a.value.length).toBeGreaterThan(0);
  });

  it("fails on chosen chunks only (partial failure mid-stream) and records calls without audio", async () => {
    const fake = createFakeTranscriber();
    fake.script.failOnChunk("c2", "unavailable");
    const results = [];
    for (const id of ["c1", "c2", "c3"]) {
      results.push(await fake.transcribe({ chunkId: id, audio, contentType: "audio/webm" }));
    }
    expect(results.map((r) => r.ok)).toEqual([true, false, true]);
    expect(fake.calls.map((c) => c.chunkId)).toEqual(["c1", "c2", "c3"]);
    expect(JSON.stringify(fake.calls)).not.toContain("9");
  });

  it("can fail a chunk a fixed number of times and then succeed (retry resumes)", async () => {
    const fake = createFakeTranscriber();
    fake.script.failOnChunk("c1", "timeout", 2);
    const outcomes = [];
    for (let i = 0; i < 3; i++) {
      outcomes.push(
        (await fake.transcribe({ chunkId: "c1", audio, contentType: "audio/webm" })).ok,
      );
    }
    expect(outcomes).toEqual([false, false, true]);
  });
});

import { describe, expect, it } from "vitest";
import type { ProviderErrorKind } from "../../../src/domain/platform/provider-error";
import type { Transcriber } from "../../../src/ports/transcriber";

export interface TranscriberHarness {
  transcriber: Transcriber;
  /** The provider will answer the next call with these utterances (start/end in ms). */
  respondWith(
    utterances: { startMs: number; endMs: number; speaker: number | null; text: string }[],
  ): void;
  /** Make the next call fail the way the provider would for `kind`. */
  failNext(kind: ProviderErrorKind): void;
}

const AUDIO = new Uint8Array([1, 2, 3, 4]);
const request = (chunkId = "chunk-1") => ({ chunkId, audio: AUDIO, contentType: "audio/webm" });

/**
 * Shared contract (CLAUDE.md section 5, Liskov): the fake and the real adapter must look the
 * same to callers, including how they fail. Run against both.
 */
export function transcriberContract(name: string, create: () => TranscriberHarness): void {
  describe(`Transcriber contract: ${name}`, () => {
    it("returns ordered segments with times, speaker labels and text", async () => {
      const h = create();
      h.respondWith([
        { startMs: 2500, endMs: 4000, speaker: 1, text: " Sounds good. " },
        { startMs: 0, endMs: 2400, speaker: 0, text: "Let's begin." },
      ]);
      const result = await h.transcriber.transcribe(request());
      expect(result).toEqual({
        ok: true,
        value: [
          { startMs: 0, endMs: 2400, speaker: "Speaker 1", text: "Let's begin." },
          { startMs: 2500, endMs: 4000, speaker: "Speaker 2", text: "Sounds good." },
        ],
      });
    });

    it("falls back to Speaker 1 when the provider has no diarization", async () => {
      const h = create();
      h.respondWith([{ startMs: 0, endMs: 1000, speaker: null, text: "Solo" }]);
      const result = await h.transcriber.transcribe(request());
      expect(result.ok && result.value[0]?.speaker).toBe("Speaker 1");
    });

    it("returns an empty list for silence", async () => {
      const h = create();
      h.respondWith([]);
      expect(await h.transcriber.transcribe(request())).toEqual({ ok: true, value: [] });
    });

    it("is deterministic: the same chunk twice yields the same segments", async () => {
      const h = create();
      const utterances = [{ startMs: 0, endMs: 500, speaker: 0, text: "Same" }];
      h.respondWith(utterances);
      const first = await h.transcriber.transcribe(request("c"));
      h.respondWith(utterances);
      const second = await h.transcriber.transcribe(request("c"));
      expect(second).toEqual(first);
    });

    it.each([
      ["timeout", true],
      ["rate_limited", true],
      ["unavailable", true],
      ["rejected", false],
    ] as const)("reports %s as a normalized error (retryable: %s)", async (kind, retryable) => {
      const h = create();
      h.failNext(kind);
      const result = await h.transcriber.transcribe(request());
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe(kind);
      expect(result.error.retryable).toBe(retryable);
      expect(result.error.message).not.toMatch(/secret|token|key/i);
    });

    it("recovers on the next call after a failure", async () => {
      const h = create();
      h.failNext("unavailable");
      await h.transcriber.transcribe(request());
      h.respondWith([{ startMs: 0, endMs: 100, speaker: 0, text: "Back" }]);
      expect((await h.transcriber.transcribe(request())).ok).toBe(true);
    });

    it("rejects empty and oversized audio without calling the provider", async () => {
      const h = create();
      const empty = await h.transcriber.transcribe({ ...request(), audio: new Uint8Array(0) });
      const huge = await h.transcriber.transcribe({
        ...request(),
        audio: new Uint8Array(1_048_577),
      });
      for (const r of [empty, huge]) {
        expect(r.ok).toBe(false);
        if (!r.ok) {
          expect(r.error.kind).toBe("rejected");
          expect(r.error.retryable).toBe(false);
        }
      }
    });
  });
}

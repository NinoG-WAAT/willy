import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startSegmentedRecorder } from "../../../src/scripts/capture/recorder";

/**
 * A MediaRecorder as browsers behave: stop() flips `state` to "inactive" at once, and the
 * dataavailable and stop events arrive later, as separate tasks.
 */
class FakeMediaRecorder {
  static readonly STOP_EVENT_DELAY_MS = 5;
  static isTypeSupported = (): boolean => true;
  state: "inactive" | "recording" = "inactive";
  mimeType = "audio/webm";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  start(): void {
    this.state = "recording";
  }
  stop(): void {
    if (this.state !== "recording") throw new Error("InvalidStateError");
    this.state = "inactive";
    setTimeout(() => {
      this.ondataavailable?.({ data: new Blob([new Uint8Array(4)]) });
      this.onstop?.();
    }, FakeMediaRecorder.STOP_EVENT_DELAY_MS);
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const stream = {} as MediaStream;

describe("segmented recorder", () => {
  it("delivers the segment being recorded before stop() resolves", async () => {
    const segments: number[] = [];
    const recorder = startSegmentedRecorder(stream, 1_000, (blob) => segments.push(blob.size));
    await vi.advanceTimersByTimeAsync(400);
    const stopped = recorder.stop();
    await vi.advanceTimersByTimeAsync(10);
    await stopped;
    expect(segments).toEqual([4]);
  });

  it("rotates to a new segment every segmentMs while recording", async () => {
    const segments: number[] = [];
    startSegmentedRecorder(stream, 1_000, (blob) => segments.push(blob.size));
    await vi.advanceTimersByTimeAsync(2_500);
    expect(segments).toHaveLength(2);
  });

  // Issue #65 (found while reproducing it): when Stop lands in the few milliseconds after a
  // segment's timer fired but before its stop event, the old code resolved at once because the
  // recorder already read "inactive". The owner's last segment then reached the queue after the
  // page had decided that every upload was done, and was sent after (or lost to) the Stop.
  it("waits for a segment whose timer has already stopped it, instead of resolving early", async () => {
    const segments: number[] = [];
    const recorder = startSegmentedRecorder(stream, 1_000, (blob) => segments.push(blob.size));
    await vi.advanceTimersByTimeAsync(1_000); // timer fired: recorder is inactive, stop event pending
    let resolved = false;
    const stopped = recorder.stop().then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(10);
    await stopped;
    expect(segments).toEqual([4]);
    // And it does not start another segment after being stopped.
    await vi.advanceTimersByTimeAsync(3_000);
    expect(segments).toEqual([4]);
  });
});

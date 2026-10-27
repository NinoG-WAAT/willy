const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];

export function supportsRecording(): boolean {
  return (
    typeof MediaRecorder !== "undefined" &&
    typeof navigator.mediaDevices !== "undefined" &&
    typeof navigator.mediaDevices.getUserMedia === "function"
  );
}

function pickMimeType(): string | undefined {
  return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type));
}

export interface SegmentedRecorder {
  /** Finishes the current segment (it is delivered) and stops recording. */
  stop(): Promise<void>;
}

/**
 * Records the stream as a series of short, self-contained audio files. A MediaRecorder timeslice
 * would produce fragments that only the first of which has a header, so each segment is its own
 * recorder run: every uploaded chunk can be transcribed independently and retried on its own.
 * There is a gap of a few milliseconds between segments.
 */
export function startSegmentedRecorder(
  stream: MediaStream,
  segmentMs: number,
  onSegment: (blob: Blob, durationMs: number) => void,
): SegmentedRecorder {
  const mimeType = pickMimeType();
  let current: MediaRecorder | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopping = false;
  let finished: (() => void) | undefined;

  function begin(): void {
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const parts: Blob[] = [];
    const startedAt = performance.now();
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) parts.push(event.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(parts, { type: recorder.mimeType || mimeType || "audio/webm" });
      if (blob.size > 0) onSegment(blob, Math.max(1, Math.round(performance.now() - startedAt)));
      if (stopping) finished?.();
      else begin();
    };
    recorder.start();
    current = recorder;
    timer = setTimeout(() => {
      if (recorder.state === "recording") recorder.stop();
    }, segmentMs);
  }

  begin();

  return {
    stop(): Promise<void> {
      stopping = true;
      clearTimeout(timer);
      return new Promise((resolve) => {
        finished = resolve;
        if (current && current.state === "recording") current.stop();
        else resolve();
      });
    },
  };
}

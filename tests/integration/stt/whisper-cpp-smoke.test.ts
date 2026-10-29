import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { describe, expect, it } from "vitest";
import { createTranscriber } from "../../../src/adapters/stt";
import { readSttConfig } from "../../../src/adapters/stt/config";

/**
 * Manual smoke test against a REAL whisper-cli and ffmpeg. Skipped unless you opt in, so CI never
 * needs a binary or a model. Run it with a short recording you made yourself:
 *
 *   STT_PROVIDER=whisper STT_WHISPER_MODEL=/path/to/ggml-base.bin \
 *   WHISPER_SMOKE_AUDIO=/path/to/clip.webm \
 *   npx vitest run tests/integration/stt/whisper-cpp-smoke
 *
 * The audio is read locally and never leaves the machine.
 */
const audioPath = process.env["WHISPER_SMOKE_AUDIO"];
const TYPES: Record<string, string> = {
  ".webm": "audio/webm",
  ".ogg": "audio/ogg",
  ".mp4": "audio/mp4",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
};

describe.skipIf(!audioPath || process.env["STT_PROVIDER"] !== "whisper")(
  "real whisper.cpp smoke test (manual)",
  () => {
    it("transcribes a real recording into ordered, non-empty segments", async () => {
      const config = readSttConfig(process.env);
      if (!config.ok) throw new Error(config.error);
      const file = audioPath ?? "";
      const contentType = TYPES[extname(file).toLowerCase()];
      if (!contentType) {
        throw new Error("WHISPER_SMOKE_AUDIO must be webm, ogg, mp4, m4a, mp3 or wav");
      }
      const audio = new Uint8Array(await readFile(file));

      const result = await createTranscriber(config.value, fetch).transcribe({
        chunkId: "smoke",
        audio,
        contentType,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.length).toBeGreaterThan(0);
      const starts = result.value.map((s) => s.startMs);
      expect(starts).toEqual([...starts].sort((a, b) => a - b));
    });
  },
);

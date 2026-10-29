import { chmod, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWhisperCppTranscriber } from "../../../src/adapters/stt/whisper-cpp-transcriber";

/**
 * The same adapter, but through the real process runner and two tiny POSIX scripts that imitate
 * the command lines of ffmpeg and whisper-cli. This proves the wiring (argv, files, exit codes,
 * timeouts, cleanup) end to end without needing either tool installed. It does NOT prove that
 * the real tools accept these arguments: that is the manual smoke test.
 */
describe.skipIf(process.platform === "win32")("whisper.cpp transcriber via real processes", () => {
  let root: string;
  let temp: string;
  let model: string;
  let ffmpeg: string;
  let whisper: string;

  async function script(name: string, body: string): Promise<string> {
    const path = join(root, name);
    await writeFile(path, `#!/bin/sh\n${body}\n`);
    await chmod(path, 0o755);
    return path;
  }

  const audio = new Uint8Array([1, 2, 3]);
  const request = { chunkId: "c1", audio, contentType: "audio/webm" };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "willy-whisper-proc-"));
    temp = join(root, "tmp");
    await mkdir(temp);
    model = join(root, "model.bin");
    await writeFile(model, "m");
    // ffmpeg: the output is the last argument; fail on input that is not our audio.
    ffmpeg = await script(
      "ffmpeg",
      [
        'for a in "$@"; do last="$a"; done',
        'while [ "$#" -gt 0 ]; do if [ "$1" = "-i" ]; then in="$2"; fi; shift; done',
        'if [ "$(wc -c < "$in" | tr -d " ")" = "3" ]; then printf RIFF > "$last"; exit 0; fi',
        "exit 1",
      ].join("\n"),
    );
    whisper = await script(
      "whisper-cli",
      [
        'while [ "$#" -gt 0 ]; do if [ "$1" = "-of" ]; then of="$2"; fi; shift; done',
        `printf '%s' '{"transcription":[{"offsets":{"from":0,"to":1500},"text":" Hello there."}]}' > "$of.json"`,
      ].join("\n"),
    );
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const build = (over: { whisperBin?: string; ffmpegBin?: string; timeoutMs?: number } = {}) =>
    createWhisperCppTranscriber(
      {
        whisperBin: over.whisperBin ?? whisper,
        ffmpegBin: over.ffmpegBin ?? ffmpeg,
        modelPath: model,
        language: "en",
        timeoutMs: over.timeoutMs ?? 10_000,
        maxConcurrency: 1,
      },
      { tempRoot: temp },
    );

  it("transcribes through both processes and leaves nothing behind", async () => {
    expect(await build().transcribe(request)).toEqual({
      ok: true,
      value: [{ startMs: 0, endMs: 1500, speaker: "Speaker 1", text: "Hello there." }],
    });
    expect(await readdir(temp)).toEqual([]);
  });

  it("reports audio that ffmpeg cannot decode as rejected", async () => {
    const result = await build().transcribe({ ...request, audio: new Uint8Array([1, 2, 3, 4, 5]) });
    expect(result).toMatchObject({ ok: false, error: { kind: "rejected", retryable: false } });
    expect(await readdir(temp)).toEqual([]);
  });

  it("reports a missing ffmpeg or whisper-cli as unavailable", async () => {
    for (const over of [
      { ffmpegBin: join(root, "no-ffmpeg") },
      { whisperBin: join(root, "no-whisper") },
    ]) {
      expect(await build(over).transcribe(request)).toMatchObject({
        ok: false,
        error: { kind: "unavailable", retryable: true },
      });
    }
    expect(await readdir(temp)).toEqual([]);
  });

  it("kills a hung whisper-cli at the timeout and cleans up", async () => {
    const slow = await script("slow-whisper", "exec sleep 30");
    const started = Date.now();
    const result = await build({ whisperBin: slow, timeoutMs: 1000 }).transcribe(request);
    expect(result).toMatchObject({ ok: false, error: { kind: "timeout", retryable: true } });
    expect(Date.now() - started).toBeLessThan(8000);
    expect(await readdir(temp)).toEqual([]);
  });
});

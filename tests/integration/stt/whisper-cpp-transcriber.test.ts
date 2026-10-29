import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CommandOutcome, CommandRunner } from "../../../src/adapters/process/run-command";
import {
  createWhisperCppTranscriber,
  type WhisperCppConfig,
} from "../../../src/adapters/stt/whisper-cpp-transcriber";
import type { ProviderErrorKind } from "../../../src/domain/platform/provider-error";
import { defined } from "../../support/assert";
import { transcriberContract } from "./transcriber.contract";

interface Utterance {
  startMs: number;
  endMs: number;
  speaker: number | null;
  text: string;
}

interface Call {
  file: string;
  args: string[];
  timeoutMs: number;
}

const FFMPEG = "/fake/bin/ffmpeg";
const WHISPER = "/fake/bin/whisper-cli";
const SECRET_AUDIO = new Uint8Array([7, 7, 7, 7]);

let root: string;
let modelPath: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "willy-whisper-test-"));
  modelPath = join(root, "ggml-test.bin");
  await writeFile(modelPath, "model");
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const flagValue = (args: readonly string[], flag: string): string =>
  defined(args[args.indexOf(flag) + 1]);

/** Whisper-cli's real JSON layout (offsets are milliseconds). */
function whisperJson(utterances: readonly { startMs: number; endMs: number; text: string }[]) {
  return JSON.stringify({
    systeminfo: "stub",
    model: { type: "base" },
    params: { language: "auto" },
    result: { language: "en" },
    transcription: utterances.map((u) => ({
      timestamps: { from: "00:00:00,000", to: "00:00:01,000" },
      offsets: { from: u.startMs, to: u.endMs },
      text: u.text,
    })),
  });
}

/**
 * Stands in for ffmpeg and whisper-cli. It follows their real contracts: ffmpeg reads `-i` and
 * writes the last argument; whisper-cli reads `-f` and writes `<-of>.json`. Never touches a
 * real binary or model.
 */
function createStubRunner() {
  const calls: Call[] = [];
  const dirsSeen: string[] = [];
  const modes: { dir: number; input: number }[] = [];
  let utterances: Utterance[] = [];
  let rawJson: string | null = null;
  let whisperOutcome: CommandOutcome | null = null;
  let ffmpegOutcome: CommandOutcome | null = null;
  let skipJson = false;
  let gate: Promise<void> | null = null;
  let active = 0;
  let peak = 0;

  const run: CommandRunner = async (file, args, options) => {
    calls.push({ file, args: [...args], timeoutMs: options.timeoutMs });
    if (file === FFMPEG) {
      const outcome = ffmpegOutcome;
      ffmpegOutcome = null;
      if (outcome) return outcome;
      const input = flagValue(args, "-i");
      const output = defined(args[args.length - 1]);
      dirsSeen.push(join(input, ".."));
      modes.push({
        dir: (await stat(join(input, ".."))).mode & 0o777,
        input: (await stat(input)).mode & 0o777,
      });
      expect(new Uint8Array(await readFile(input))).toEqual(SECRET_AUDIO);
      await writeFile(output, "RIFFwav");
      return { kind: "exited", code: 0 };
    }
    active += 1;
    peak = Math.max(peak, active);
    try {
      if (gate) await gate;
      const outcome = whisperOutcome;
      whisperOutcome = null;
      if (outcome) return outcome;
      await readFile(flagValue(args, "-f"));
      if (!skipJson) {
        await writeFile(
          `${flagValue(args, "-of")}.json`,
          rawJson ?? whisperJson(utterances.map((u) => ({ ...u, text: ` ${u.text} ` }))),
        );
      }
      return { kind: "exited", code: 0 };
    } finally {
      active -= 1;
    }
  };

  return {
    run,
    calls,
    modes,
    get peak() {
      return peak;
    },
    respondWith: (u: Utterance[]) => {
      utterances = u;
      rawJson = null;
    },
    respondRawJson: (json: string) => {
      rawJson = json;
    },
    withholdOutput: () => {
      skipJson = true;
    },
    failWhisper: (outcome: CommandOutcome) => {
      whisperOutcome = outcome;
    },
    failFfmpeg: (outcome: CommandOutcome) => {
      ffmpegOutcome = outcome;
    },
    holdWhisperUntil: (promise: Promise<void>) => {
      gate = promise;
    },
  };
}

function build(overrides: Partial<WhisperCppConfig> = {}) {
  const stub = createStubRunner();
  const transcriber = createWhisperCppTranscriber(
    {
      whisperBin: WHISPER,
      ffmpegBin: FFMPEG,
      modelPath,
      language: "auto",
      timeoutMs: 10_000,
      maxConcurrency: 1,
      ...overrides,
    },
    { run: stub.run, tempRoot: root },
  );
  return { stub, transcriber };
}

const request = (chunkId = "chunk-1", contentType = "audio/webm") => ({
  chunkId,
  audio: SECRET_AUDIO,
  contentType,
});

transcriberContract(
  "whisper.cpp (stubbed ffmpeg and whisper-cli)",
  () => {
    const { stub, transcriber } = build();
    return {
      transcriber,
      respondWith: stub.respondWith,
      failNext: (kind: ProviderErrorKind) => {
        if (kind === "timeout") stub.failWhisper({ kind: "timeout" });
        else if (kind === "unavailable") stub.failWhisper({ kind: "not_found" });
        else if (kind === "rejected") stub.failFfmpeg({ kind: "exited", code: 1 });
        else throw new Error(`whisper cannot produce ${kind}`);
      },
    };
  },
  { diarization: false, failureKinds: ["timeout", "unavailable", "rejected"] },
);

describe("whisper.cpp transcriber specifics", () => {
  it("converts to 16 kHz mono WAV with a forced demuxer and no network or foreign files", async () => {
    const { stub, transcriber } = build({ language: "fr" });
    stub.respondWith([{ startMs: 0, endMs: 900, speaker: null, text: "Bonjour" }]);
    await transcriber.transcribe(request("c1", "audio/webm;codecs=opus"));

    const [ffmpeg, whisper] = stub.calls;
    expect(ffmpeg?.file).toBe(FFMPEG);
    const a = defined(ffmpeg).args;
    expect(flagValue(a, "-ac")).toBe("1");
    expect(flagValue(a, "-ar")).toBe("16000");
    expect(flagValue(a, "-f")).toBe("matroska,webm"); // input demuxer, given before -i
    expect(a.indexOf("-f")).toBeLessThan(a.indexOf("-i"));
    expect(flagValue(a, "-protocol_whitelist")).toBe("file");
    expect(a).toContain("-nostdin");

    expect(whisper?.file).toBe(WHISPER);
    const w = defined(whisper).args;
    expect(flagValue(w, "-m")).toBe(modelPath);
    expect(flagValue(w, "-l")).toBe("fr");
    expect(w).toContain("-oj");
    expect(w).toContain("-np");
  });

  it.each([
    ["audio/webm", "matroska,webm"],
    ["audio/ogg;codecs=opus", "ogg"],
    ["audio/mp4", "mov,mp4,m4a,3gp,3g2,mj2"],
    ["audio/mpeg", "mp3"],
    ["audio/wav", "wav"],
  ])("forces the %s demuxer instead of trusting the file contents", async (type, demuxer) => {
    const { stub, transcriber } = build();
    await transcriber.transcribe(request("c", type));
    expect(flagValue(defined(stub.calls[0]).args, "-f")).toBe(demuxer);
  });

  it("never puts the chunk id or audio-derived text into arguments or paths", async () => {
    const { stub, transcriber } = build();
    await transcriber.transcribe(request("meeting-ABC-secret-chunk"));
    expect(JSON.stringify(stub.calls)).not.toContain("meeting-ABC-secret-chunk");
  });

  it("uses a private temp directory and removes it after success", async () => {
    const { stub, transcriber } = build();
    stub.respondWith([{ startMs: 0, endMs: 1, speaker: null, text: "x" }]);
    await transcriber.transcribe(request());
    expect(stub.modes).toEqual([{ dir: 0o700, input: 0o600 }]);
    expect(await readdir(root)).toEqual(["ggml-test.bin"]);
  });

  it.each([
    ["ffmpeg rejects the audio", (s: ReturnType<typeof createStubRunner>) => s.failFfmpeg({ kind: "exited", code: 1 })],
    ["whisper-cli fails", (s: ReturnType<typeof createStubRunner>) => s.failWhisper({ kind: "exited", code: 3 })],
    ["whisper-cli times out", (s: ReturnType<typeof createStubRunner>) => s.failWhisper({ kind: "timeout" })],
    ["whisper-cli writes no output", (s: ReturnType<typeof createStubRunner>) => s.withholdOutput()],
    ["whisper-cli writes garbage", (s: ReturnType<typeof createStubRunner>) => s.respondRawJson("{nope")],
  ])("removes the temp directory when %s", async (_name, arrange) => {
    const { stub, transcriber } = build();
    arrange(stub);
    const result = await transcriber.transcribe(request());
    expect(result.ok).toBe(false);
    expect(await readdir(root)).toEqual(["ggml-test.bin"]);
  });

  it("maps failures to normalized, non-leaking errors", async () => {
    const cases: [string, (s: ReturnType<typeof createStubRunner>) => void, ProviderErrorKind, boolean][] = [
      ["ffmpeg exit 1", (s) => s.failFfmpeg({ kind: "exited", code: 1 }), "rejected", false],
      ["ffmpeg missing", (s) => s.failFfmpeg({ kind: "not_found" }), "unavailable", true],
      ["ffmpeg timeout", (s) => s.failFfmpeg({ kind: "timeout" }), "timeout", true],
      ["ffmpeg killed", (s) => s.failFfmpeg({ kind: "failed" }), "unavailable", true],
      ["whisper missing", (s) => s.failWhisper({ kind: "not_found" }), "unavailable", true],
      ["whisper exit", (s) => s.failWhisper({ kind: "exited", code: 4 }), "unavailable", true],
      ["whisper timeout", (s) => s.failWhisper({ kind: "timeout" }), "timeout", true],
      ["whisper killed", (s) => s.failWhisper({ kind: "failed" }), "unavailable", true],
    ];
    for (const [name, arrange, kind, retryable] of cases) {
      const { stub, transcriber } = build();
      arrange(stub);
      const result = await transcriber.transcribe(request("secret-chunk-id"));
      expect(result.ok, name).toBe(false);
      if (result.ok) continue;
      expect(result.error.kind, name).toBe(kind);
      expect(result.error.retryable, name).toBe(retryable);
      expect(result.error.message).not.toContain(root);
      expect(result.error.message).not.toContain(modelPath);
      expect(result.error.message).not.toContain("secret-chunk-id");
    }
  });

  it("reports a missing model file as unavailable without running anything", async () => {
    const { stub, transcriber } = build({ modelPath: join(root, "missing.bin") });
    const result = await transcriber.transcribe(request());
    expect(result).toMatchObject({ ok: false, error: { kind: "unavailable", retryable: true } });
    expect(stub.calls).toEqual([]);
    expect(await readdir(root)).toEqual(["ggml-test.bin"]);
  });

  it("rejects disallowed types and sizes before creating any file or process", async () => {
    const { stub, transcriber } = build();
    const types = await transcriber.transcribe(request("c", "application/x-mpegURL"));
    const empty = await transcriber.transcribe({ ...request(), audio: new Uint8Array(0) });
    const huge = await transcriber.transcribe({ ...request(), audio: new Uint8Array(1_048_577) });
    for (const r of [types, empty, huge]) {
      expect(r).toMatchObject({ ok: false, error: { kind: "rejected", retryable: false } });
    }
    expect(stub.calls).toEqual([]);
  });

  it("keeps a single time budget across both steps", async () => {
    const { stub, transcriber } = build({ timeoutMs: 5000 });
    await transcriber.transcribe(request());
    const [ffmpeg, whisper] = stub.calls.map((c) => c.timeoutMs);
    expect(defined(ffmpeg)).toBeLessThanOrEqual(5000);
    expect(defined(whisper)).toBeLessThanOrEqual(defined(ffmpeg));
    expect(defined(whisper)).toBeGreaterThan(0);
  });

  it("drops Whisper's non-speech annotations so silence yields no segments", async () => {
    const { stub, transcriber } = build();
    stub.respondWith([
      { startMs: 0, endMs: 1000, speaker: null, text: "[BLANK_AUDIO]" },
      { startMs: 1000, endMs: 2000, speaker: null, text: "(silence)" },
      { startMs: 2000, endMs: 3000, speaker: null, text: "[ Silence ]" },
      { startMs: 3000, endMs: 4000, speaker: null, text: "Real words [laughs] here." },
    ]);
    expect(await transcriber.transcribe(request())).toEqual({
      ok: true,
      value: [{ startMs: 3000, endMs: 4000, speaker: "Speaker 1", text: "Real words [laughs] here." }],
    });
  });

  it.each([
    ["not JSON", "{nope"],
    ["an array", "[]"],
    ["no transcription list", "{}"],
    ["a segment without offsets", '{"transcription":[{"text":"x"}]}'],
    ["a non-numeric offset", '{"transcription":[{"offsets":{"from":"a","to":1},"text":"x"}]}'],
    ["a non-string text", '{"transcription":[{"offsets":{"from":0,"to":1},"text":5}]}'],
    ["reversed times", '{"transcription":[{"offsets":{"from":9,"to":1},"text":"x"}]}'],
  ])("treats %s as an unavailable provider, never as a crash", async (_name, json) => {
    const { stub, transcriber } = build();
    stub.respondRawJson(json);
    expect(await transcriber.transcribe(request())).toMatchObject({
      ok: false,
      error: { kind: "unavailable", retryable: true },
    });
  });

  it("rejects an absurd number of segments instead of storing them", async () => {
    const { stub, transcriber } = build();
    stub.respondWith(
      Array.from({ length: 201 }, (_v, i) => ({
        startMs: i,
        endMs: i + 1,
        speaker: null,
        text: `w${String(i)}`,
      })),
    );
    expect(await transcriber.transcribe(request())).toMatchObject({
      ok: false,
      error: { kind: "unavailable" },
    });
  });

  it("caps concurrent runs (one at a time by default) and still serves every request", async () => {
    const { stub, transcriber } = build({ maxConcurrency: 1 });
    let release: () => void = () => undefined;
    stub.holdWhisperUntil(new Promise<void>((resolve) => (release = resolve)));
    const all = [1, 2, 3].map((i) => transcriber.transcribe(request(`c${String(i)}`)));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(stub.peak).toBe(1);
    release();
    const results = await Promise.all(all);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(stub.peak).toBe(1);
  });

  it("allows the configured number of parallel runs and no more", async () => {
    const { stub, transcriber } = build({ maxConcurrency: 2 });
    let release: () => void = () => undefined;
    stub.holdWhisperUntil(new Promise<void>((resolve) => (release = resolve)));
    const all = [1, 2, 3, 4].map((i) => transcriber.transcribe(request(`c${String(i)}`)));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(stub.peak).toBe(2);
    release();
    await Promise.all(all);
    expect(stub.peak).toBe(2);
  });

  it("does not charge time spent waiting in the queue against the timeout", async () => {
    const { stub, transcriber } = build({ timeoutMs: 5000, maxConcurrency: 1 });
    let release: () => void = () => undefined;
    stub.holdWhisperUntil(new Promise<void>((resolve) => (release = resolve)));
    const first = transcriber.transcribe(request("a"));
    const second = transcriber.transcribe(request("b"));
    await new Promise((resolve) => setTimeout(resolve, 300));
    release();
    await Promise.all([first, second]);
    const ffmpegBudgets = stub.calls.filter((c) => c.file === FFMPEG).map((c) => c.timeoutMs);
    expect(defined(ffmpegBudgets[1])).toBeGreaterThan(4900);
  });

  it("releases its slot after a failure so later chunks still run", async () => {
    const { stub, transcriber } = build({ maxConcurrency: 1 });
    stub.failFfmpeg({ kind: "exited", code: 1 });
    expect((await transcriber.transcribe(request("a"))).ok).toBe(false);
    stub.respondWith([{ startMs: 0, endMs: 1, speaker: null, text: "ok" }]);
    expect((await transcriber.transcribe(request("b"))).ok).toBe(true);
  });
});

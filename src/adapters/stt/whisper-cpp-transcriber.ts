import { constants } from "node:fs";
import { access, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { providerError, type ProviderError } from "../../domain/platform/provider-error";
import { err, ok, type Result } from "../../domain/platform/result";
import { MAX_CHUNK_BYTES, normalizeAudioContentType } from "../../domain/transcription/audio";
import {
  normalizeSegments,
  type RawSegment,
  type TranscribedSegment,
} from "../../domain/transcription/segments";
import type { Transcriber } from "../../ports/transcriber";
import { runCommand, type CommandOutcome, type CommandRunner } from "../process/run-command";
import type { WhisperSttConfig } from "./config";

export type WhisperCppConfig = Omit<WhisperSttConfig, "mode">;

export interface WhisperCppDeps {
  /** Injected so tests never need a real binary. */
  run?: CommandRunner;
  /** Where private per-chunk directories are made. Defaults to the OS temp directory. */
  tempRoot?: string;
}

/** whisper-cli never writes more than a few KB for a 10 s chunk; anything near this is nonsense. */
const MAX_OUTPUT_BYTES = 1_048_576;

/**
 * The container is chosen from the (allowlisted) content type and forced with `-f`, so ffmpeg
 * never auto-detects exotic demuxers (HLS/concat playlists can name other files or URLs).
 * Browsers upload webm/opus (Chrome, Firefox), ogg/opus (Firefox) or mp4/aac (Safari).
 */
const INPUT_FORMATS: Readonly<Record<string, { demuxer: string; extension: string }>> = {
  "audio/webm": { demuxer: "matroska,webm", extension: "webm" },
  "audio/ogg": { demuxer: "ogg", extension: "ogg" },
  "audio/mp4": { demuxer: "mov,mp4,m4a,3gp,3g2,mj2", extension: "mp4" },
  "audio/mpeg": { demuxer: "mp3", extension: "mp3" },
  "audio/wav": { demuxer: "wav", extension: "wav" },
};

/** Whisper marks silence and noise as "[BLANK_AUDIO]", "(silence)", "[ Music ]": not speech. */
const NON_SPEECH_ANNOTATION = /^(?:[[(][^\])]*[\])]\s*)+$/;

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const unexpectedOutput = (): ProviderError =>
  providerError("unavailable", "whisper-cli returned unexpected output");

/** Reads whisper-cli's `-oj` file (offsets in ms, relative to the chunk). Null if the shape is wrong. */
function rawSegments(json: unknown): RawSegment[] | null {
  if (!isObject(json) || !Array.isArray(json["transcription"])) return null;
  const segments: RawSegment[] = [];
  for (const item of json["transcription"] as unknown[]) {
    if (!isObject(item) || !isObject(item["offsets"]) || typeof item["text"] !== "string") {
      return null;
    }
    const { from, to } = item["offsets"];
    if (typeof from !== "number" || typeof to !== "number") return null;
    if (NON_SPEECH_ANNOTATION.test(item["text"].trim())) continue;
    // Whisper has no speaker diarization: the port's default label ("Speaker 1") applies.
    segments.push({ startMs: Math.round(from), endMs: Math.round(to), text: item["text"] });
  }
  return segments;
}

/** Null when the step succeeded. Messages are fixed text: no paths, ids or tool output. */
function failureOf(step: "ffmpeg" | "whisper-cli", outcome: CommandOutcome): ProviderError | null {
  switch (outcome.kind) {
    case "timeout":
      return providerError("timeout", `${step} exceeded the time limit`);
    case "not_found":
      return providerError("unavailable", `${step} is not installed or not executable`);
    case "failed":
      return providerError("unavailable", `${step} was interrupted`);
    case "exited":
      if (outcome.code === 0) return null;
      // ffmpeg failing on a file we just wrote means the audio itself is bad: retrying cannot help.
      return step === "ffmpeg"
        ? providerError("rejected", "audio could not be decoded")
        : providerError("unavailable", "whisper-cli exited with an error");
  }
}

/** Limits how many Whisper runs happen at once; later chunks wait, they are not dropped. */
function createSlots(max: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return {
    async acquire(): Promise<void> {
      if (active < max) {
        active += 1;
        return;
      }
      await new Promise<void>((resolve) => waiting.push(resolve));
    },
    release(): void {
      const next = waiting.shift();
      if (next) next();
      else active -= 1;
    },
  };
}

/**
 * Local speech-to-text with whisper.cpp: the audio never leaves this machine. Each chunk is
 * written to a private temp directory, converted to 16 kHz mono WAV by ffmpeg (whisper-cli cannot
 * read webm/opus or mp4/aac, which is what browsers record), transcribed by whisper-cli, and
 * the directory is removed in `finally`. Both tools run with fixed argv arrays and no shell.
 */
export function createWhisperCppTranscriber(
  config: WhisperCppConfig,
  deps: WhisperCppDeps = {},
): Transcriber {
  const run = deps.run ?? runCommand;
  const tempRoot = deps.tempRoot ?? tmpdir();
  const slots = createSlots(config.maxConcurrency);

  async function convertAndTranscribe(
    dir: string,
    audio: Uint8Array,
    format: { demuxer: string; extension: string },
    deadline: number,
  ): Promise<Result<TranscribedSegment[], ProviderError>> {
    const input = join(dir, `chunk.${format.extension}`);
    const wav = join(dir, "chunk.wav");
    const outputPrefix = join(dir, "out");
    await writeFile(input, audio, { mode: 0o600 });

    const budget = (): number => deadline - Date.now();

    if (budget() <= 0) return err(providerError("timeout", "ffmpeg exceeded the time limit"));
    const converted = await run(
      config.ffmpegBin,
      [
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-protocol_whitelist",
        "file",
        "-f",
        format.demuxer,
        "-i",
        input,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "pcm_s16le",
        "-f",
        "wav",
        "-y",
        wav,
      ],
      { timeoutMs: budget() },
    );
    const conversionFailure = failureOf("ffmpeg", converted);
    if (conversionFailure) return err(conversionFailure);

    if (budget() <= 0) return err(providerError("timeout", "whisper-cli exceeded the time limit"));
    const transcribed = await run(
      config.whisperBin,
      ["-m", config.modelPath, "-f", wav, "-l", config.language, "-oj", "-of", outputPrefix, "-np"],
      { timeoutMs: budget() },
    );
    const transcriptionFailure = failureOf("whisper-cli", transcribed);
    if (transcriptionFailure) return err(transcriptionFailure);

    const outputFile = `${outputPrefix}.json`;
    let json: unknown;
    try {
      if ((await stat(outputFile)).size > MAX_OUTPUT_BYTES) return err(unexpectedOutput());
      json = JSON.parse(await readFile(outputFile, "utf8"));
    } catch {
      return err(unexpectedOutput());
    }
    const raw = rawSegments(json);
    if (raw === null) return err(unexpectedOutput());
    const normalized = normalizeSegments(raw);
    return normalized.ok ? ok(normalized.value) : err(unexpectedOutput());
  }

  return {
    async transcribe(request): Promise<Result<TranscribedSegment[], ProviderError>> {
      const contentType = normalizeAudioContentType(request.contentType);
      const format = contentType === null ? undefined : INPUT_FORMATS[contentType];
      if (format === undefined) return err(providerError("rejected", "audio type not allowed"));
      if (request.audio.byteLength === 0 || request.audio.byteLength > MAX_CHUNK_BYTES) {
        return err(providerError("rejected", "audio size not allowed"));
      }
      try {
        await access(config.modelPath, constants.R_OK);
      } catch {
        return err(providerError("unavailable", "speech model file not found or unreadable"));
      }

      await slots.acquire();
      // The time limit starts when this chunk actually gets to run, not while it waits in line.
      const deadline = Date.now() + config.timeoutMs;
      let dir: string | undefined;
      try {
        dir = await mkdtemp(join(tempRoot, "willy-stt-"));
        return await convertAndTranscribe(dir, request.audio, format, deadline);
      } catch {
        return err(
          providerError("unavailable", "local speech-to-text could not use its temp files"),
        );
      } finally {
        if (dir !== undefined)
          await rm(dir, { recursive: true, force: true }).catch(() => undefined);
        slots.release();
      }
    },
  };
}

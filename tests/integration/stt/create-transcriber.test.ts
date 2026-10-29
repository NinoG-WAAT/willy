import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTranscriber } from "../../../src/adapters/stt";
import { readSttConfig } from "../../../src/adapters/stt/config";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "willy-stt-select-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("createTranscriber", () => {
  it("selects the local whisper adapter, which never touches the network", async () => {
    const model = join(root, "model.bin");
    await writeFile(model, "m");
    const config = readSttConfig({
      STT_PROVIDER: "whisper",
      STT_WHISPER_MODEL: model,
      STT_FFMPEG_BIN: join(root, "no-such-ffmpeg"),
    });
    if (!config.ok) throw new Error(config.error);
    const forbiddenFetch: typeof fetch = () => {
      throw new Error("whisper must not use the network");
    };

    const result = await createTranscriber(config.value, forbiddenFetch).transcribe({
      chunkId: "c",
      audio: new Uint8Array([1, 2, 3]),
      contentType: "audio/webm",
    });

    // A missing tool is a normal, retryable provider failure, not an exception.
    expect(result).toMatchObject({ ok: false, error: { kind: "unavailable", retryable: true } });
  });
});

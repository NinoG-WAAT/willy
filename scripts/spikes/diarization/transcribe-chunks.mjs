// Spike #104: transcribes a directory of 10 s chunk_NNN.webm files the way the app does (each
// chunk on its own: ffmpeg to 16 kHz mono WAV, then whisper-cli -l fr -oj) and writes
// meeting-relative segments ([{startMs,endMs,text}], chunk offset = index * 10000 ms).
// Local only. Usage:
//   node transcribe-chunks.mjs CHUNK_DIR WHISPER_MODEL.bin OUT.json
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

const [dir, model, out] = process.argv.slice(2);
if (!dir || !model || !out) {
  process.stderr.write("usage: node transcribe-chunks.mjs CHUNK_DIR WHISPER_MODEL.bin OUT.json\n");
  process.exit(2);
}
const chunks = readdirSync(dir)
  .filter((f) => /^chunk_\d+\.webm$/.test(f))
  .sort();
const segments = [];
const work = mkdtempSync(join(tmpdir(), "spike-whisper-"));
const started = Date.now();
try {
  chunks.forEach((name, index) => {
    const wav = join(work, "c.wav");
    execFileSync(
      "ffmpeg",
      [
        "-nostdin",
        "-v",
        "error",
        "-f",
        "matroska,webm",
        "-i",
        join(dir, name),
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "pcm_s16le",
        "-y",
        wav,
      ],
      { stdio: "ignore" },
    );
    execFileSync(
      "whisper-cli",
      ["-m", model, "-f", wav, "-l", "fr", "-oj", "-of", join(work, "o"), "-np"],
      { stdio: "ignore" },
    );
    const json = JSON.parse(readFileSync(join(work, "o.json"), "utf8"));
    for (const item of json.transcription) {
      const text = String(item.text).trim();
      if (text === "" || /^(?:[[(][^\])]*[\])]\s*)+$/.test(text)) continue;
      segments.push({
        chunk: index,
        startMs: index * 10000 + item.offsets.from,
        endMs: index * 10000 + item.offsets.to,
        text,
      });
    }
  });
} finally {
  rmSync(work, { recursive: true, force: true });
}
writeFileSync(out, JSON.stringify(segments));
process.stdout.write(
  `${chunks.length} chunks, ${segments.length} segments, ${((Date.now() - started) / 1000).toFixed(1)} s\n`,
);

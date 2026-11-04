// Spike #104: prints a labelled transcript on the terminal so a person can judge by ear whether
// the speakers are right. Reads local files only, writes nothing.
//   node print-labelled.mjs SEGMENTS.json TURNS.txt [EXPECTED_SPEAKERS]
// SEGMENTS.json comes from transcribe-chunks.mjs; TURNS.txt is run-diarization.sh output.
import { readFileSync } from "node:fs";
import process from "node:process";
import { assignSpeakers, consolidateSpeakers } from "./map-speakers.mjs";
import { parseHyp } from "./score-diarization.mjs";

const [segPath, turnsPath, expected] = process.argv.slice(2);
if (!segPath || !turnsPath) {
  process.stderr.write(
    "usage: node print-labelled.mjs SEGMENTS.json TURNS.txt [EXPECTED_SPEAKERS]\n",
  );
  process.exit(2);
}
const segments = JSON.parse(readFileSync(segPath, "utf8"));
const turns = consolidateSpeakers(parseHyp(readFileSync(turnsPath, "utf8")), {
  expected: expected ? Number(expected) : null,
});
const labels = assignSpeakers(segments, turns);
const clock = (ms) => {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};
segments.forEach((seg, i) => {
  const { label, mixed } = labels[i];
  process.stdout.write(
    `[${clock(seg.startMs)}] ${(label ?? "Speaker 1").padEnd(10)}${mixed ? " (mixed)" : ""} ${seg.text}\n`,
  );
});

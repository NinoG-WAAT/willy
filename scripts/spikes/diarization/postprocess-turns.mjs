// Spike #104: consolidates tiny spurious speakers in a diarization result. Same text format in and
// out, so score-diarization.mjs can score the result.
//   node postprocess-turns.mjs HYP.txt [EXPECTED_SPEAKERS]
import { readFileSync } from "node:fs";
import process from "node:process";
import { consolidateSpeakers } from "./map-speakers.mjs";
import { parseHyp } from "./score-diarization.mjs";

const [hypPath, expected] = process.argv.slice(2);
if (!hypPath) {
  process.stderr.write("usage: node postprocess-turns.mjs HYP.txt [EXPECTED_SPEAKERS]\n");
  process.exit(2);
}
const turns = consolidateSpeakers(parseHyp(readFileSync(hypPath, "utf8")), {
  expected: expected ? Number(expected) : null,
});
for (const t of turns) {
  process.stdout.write(`${t.start.toFixed(3)} -- ${t.end.toFixed(3)} ${t.speaker}\n`);
}

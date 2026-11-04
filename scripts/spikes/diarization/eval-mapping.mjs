// Spike #104: how well do diarization turns label real whisper segments? Compares the label the
// mapping gives each segment with the true speaker (the truth turn overlapping the segment most).
//   node eval-mapping.mjs TRUTH.json SEGMENTS.json HYP.txt
import { readFileSync } from "node:fs";
import process from "node:process";
import { assignSpeakers } from "./map-speakers.mjs";
import { parseHyp } from "./score-diarization.mjs";

const [truthPath, segPath, hypPath] = process.argv.slice(2);
if (!truthPath || !segPath || !hypPath) {
  process.stderr.write("usage: node eval-mapping.mjs TRUTH.json SEGMENTS.json HYP.txt\n");
  process.exit(2);
}
const truth = JSON.parse(readFileSync(truthPath, "utf8"));
const segments = JSON.parse(readFileSync(segPath, "utf8"));
const turns = parseHyp(readFileSync(hypPath, "utf8"));
const labels = assignSpeakers(segments, turns);

// True speaker of a segment and how pure it is (share of the segment held by that speaker).
function truthOf(seg) {
  const s = seg.startMs / 1000;
  const e = seg.endMs / 1000;
  const per = new Map();
  for (const t of truth) {
    const o = Math.min(e, t.end) - Math.max(s, t.start);
    if (o > 0) per.set(t.speaker, (per.get(t.speaker) ?? 0) + o);
  }
  const ranked = [...per.entries()].sort((a, b) => b[1] - a[1]);
  const total = ranked.reduce((a, r) => a + r[1], 0);
  return {
    speaker: ranked[0]?.[0] ?? null,
    purity: total > 0 ? ranked[0][1] / total : 0,
    speakers: ranked.length,
  };
}
const rows = segments.map((seg, i) => ({ seg, got: labels[i], want: truthOf(seg) }));

// Label -> true speaker mapping that maximises agreement (labels are anonymous).
const gotNames = [...new Set(rows.map((r) => r.got.label).filter((l) => l !== null))];
const wantNames = [...new Set(rows.map((r) => r.want.speaker).filter((l) => l !== null))];
let best = { score: -1, map: new Map() };
const used = new Set();
const walk = (i, map) => {
  if (i === gotNames.length) {
    const score = rows.filter(
      (r) => r.got.label !== null && map.get(r.got.label) === r.want.speaker,
    ).length;
    if (score > best.score) best = { score, map: new Map(map) };
    return;
  }
  walk(i + 1, map);
  for (const w of wantNames) {
    if (used.has(w)) continue;
    used.add(w);
    map.set(gotNames[i], w);
    walk(i + 1, map);
    map.delete(gotNames[i]);
    used.delete(w);
  }
};
walk(0, new Map());

const scored = rows.filter((r) => r.want.speaker !== null);
const ok = scored.filter((r) => best.map.get(r.got.label) === r.want.speaker);
const multi = scored.filter((r) => r.want.speakers > 1 && r.want.purity < 0.8);
const multiOk = multi.filter((r) => best.map.get(r.got.label) === r.want.speaker);
const flagged = scored.filter((r) => r.got.mixed);
process.stdout.write(
  JSON.stringify({
    segments: scored.length,
    labelAccuracy: +(ok.length / scored.length).toFixed(3),
    segmentsWithTwoSpeakers: multi.length,
    ofWhichRightlyLabelled: multiOk.length,
    flaggedMixed: flagged.length,
    flaggedMixedThatWereReallyMixed: flagged.filter(
      (r) => r.want.speakers > 1 && r.want.purity < 0.8,
    ).length,
    labelsFound: gotNames.length,
    trueSpeakers: wantNames.length,
  }) + "\n",
);

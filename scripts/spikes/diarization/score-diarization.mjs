// Spike #104: tiny diarization scorer (frame-level DER with optimal speaker mapping).
//
//   node score-diarization.mjs TRUTH.json HYP.txt [--collar 0.25] [--json]
//
// TRUTH.json: [{speaker,start,end}] seconds (overlaps allowed). HYP.txt: the stdout of
// sherpa-onnx-offline-speaker-diarization (lines "0.318 -- 6.865 speaker_00"); other lines are
// ignored. DER = (missed speech + false alarm + speaker confusion) / reference speech, counted in
// 10 ms frames, with several simultaneous speakers per frame. Hypothesis speakers are mapped to
// reference speakers one-to-one so as to maximise agreement (brute force: at most a few speakers).
import { readFileSync } from "node:fs";
import process from "node:process";
import { parseArgs } from "node:util";

const FRAME = 0.01;

export function parseHyp(text) {
  const out = [];
  for (const line of text.split("\n")) {
    const m = /^\s*([\d.]+)\s+--\s+([\d.]+)\s+(\S+)\s*$/.exec(line);
    if (m) out.push({ speaker: m[3], start: Number(m[1]), end: Number(m[2]) });
  }
  return out;
}

function toFrames(segments, nFrames) {
  const names = [...new Set(segments.map((s) => s.speaker))];
  const grid = names.map(() => new Uint8Array(nFrames));
  for (const s of segments) {
    const g = grid[names.indexOf(s.speaker)];
    const a = Math.max(0, Math.round(s.start / FRAME));
    const b = Math.min(nFrames, Math.round(s.end / FRAME));
    for (let i = a; i < b; i++) g[i] = 1;
  }
  return { names, grid };
}

export function score(truth, hyp, collar = 0.25) {
  const maxEnd = Math.max(0, ...truth.map((t) => t.end), ...hyp.map((h) => h.end));
  const nFrames = Math.ceil(maxEnd / FRAME) + 1;
  const ref = toFrames(truth, nFrames);
  const hy = toFrames(hyp, nFrames);

  // Co-occurrence of each reference speaker with each hypothesis speaker.
  const co = ref.grid.map((r) =>
    hy.grid.map((h) => {
      let c = 0;
      for (let i = 0; i < nFrames; i++) c += r[i] & h[i];
      return c;
    }),
  );
  // Best one-to-one mapping (reference speaker -> hypothesis speaker or -1).
  let best = { total: -1, map: [] };
  const used = new Set();
  const walk = (r, acc, map) => {
    if (r === ref.names.length) {
      if (acc > best.total) best = { total: acc, map: [...map] };
      return;
    }
    walk(r + 1, acc, [...map, -1]);
    for (let h = 0; h < hy.names.length; h++) {
      if (used.has(h)) continue;
      used.add(h);
      walk(r + 1, acc + co[r][h], [...map, h]);
      used.delete(h);
    }
  };
  walk(0, 0, []);

  const ignore = new Uint8Array(nFrames);
  if (collar > 0) {
    const c = Math.round(collar / FRAME);
    for (const t of truth) {
      for (const edge of [t.start, t.end]) {
        const e = Math.round(edge / FRAME);
        for (let i = Math.max(0, e - c); i < Math.min(nFrames, e + c); i++) ignore[i] = 1;
      }
    }
  }

  const tally = (onlyOverlap, useCollar) => {
    let ref_ = 0;
    let miss = 0;
    let fa = 0;
    let conf = 0;
    for (let i = 0; i < nFrames; i++) {
      if (useCollar && ignore[i]) continue;
      let nref = 0;
      let nhyp = 0;
      let ncorrect = 0;
      for (let r = 0; r < ref.grid.length; r++) {
        if (ref.grid[r][i]) {
          nref++;
          const h = best.map[r];
          if (h >= 0 && hy.grid[h][i]) ncorrect++;
        }
      }
      for (let h = 0; h < hy.grid.length; h++) nhyp += hy.grid[h][i];
      if (onlyOverlap && nref < 2) continue;
      ref_ += nref;
      miss += Math.max(0, nref - nhyp);
      fa += Math.max(0, nhyp - nref);
      conf += Math.min(nref, nhyp) - ncorrect;
    }
    const sec = (x) => +(x * FRAME).toFixed(1);
    return {
      der: ref_ ? +(((miss + fa + conf) / ref_) * 100).toFixed(1) : 0,
      miss: sec(miss),
      falseAlarm: sec(fa),
      confusion: sec(conf),
      refSpeech: sec(ref_),
    };
  };

  // Short turns (< 2 s): is the turn's majority attributed to the right (mapped) speaker?
  let shortTotal = 0;
  let shortOk = 0;
  for (const t of truth) {
    if (t.end - t.start >= 2) continue;
    shortTotal++;
    const r = ref.names.indexOf(t.speaker);
    const h = best.map[r];
    const a = Math.round(t.start / FRAME);
    const b = Math.round(t.end / FRAME);
    let hit = 0;
    if (h >= 0) for (let i = a; i < b; i++) hit += hy.grid[h][i];
    if (b > a && hit / (b - a) > 0.5) shortOk++;
  }

  return {
    refSpeakers: ref.names.length,
    hypSpeakers: hy.names.length,
    noCollar: tally(false, false),
    collar: tally(false, true),
    overlapOnly: tally(true, false),
    shortTurns: { total: shortTotal, attributedCorrectly: shortOk },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      collar: { type: "string", default: "0.25" },
      json: { type: "boolean", default: false },
    },
  });
  const [truthPath, hypPath] = positionals;
  if (!truthPath || !hypPath) {
    process.stderr.write(
      "usage: node score-diarization.mjs TRUTH.json HYP.txt [--collar 0.25] [--json]\n",
    );
    process.exit(2);
  }
  const truth = JSON.parse(readFileSync(truthPath, "utf8"));
  const hyp = parseHyp(readFileSync(hypPath, "utf8"));
  const r = score(truth, hyp, Number(values.collar));
  if (values.json) process.stdout.write(`${JSON.stringify(r)}\n`);
  else {
    process.stdout.write(
      `speakers: reference ${r.refSpeakers}, found ${r.hypSpeakers}\n` +
        `DER no collar : ${r.noCollar.der}%  (miss ${r.noCollar.miss}s, false alarm ${r.noCollar.falseAlarm}s, confusion ${r.noCollar.confusion}s of ${r.noCollar.refSpeech}s)\n` +
        `DER collar ${values.collar}s: ${r.collar.der}%\n` +
        `DER on overlapped frames only: ${r.overlapOnly.der}% (${r.overlapOnly.refSpeech} speaker-seconds)\n` +
        `short turns (<2 s) attributed to the right speaker: ${r.shortTurns.attributedCorrectly}/${r.shortTurns.total}\n`,
    );
  }
}

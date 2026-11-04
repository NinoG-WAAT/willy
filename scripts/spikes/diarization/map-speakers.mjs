// Spike #104: maps diarization turns onto transcript segments. Pure functions, no I/O (the shape
// a domain module in src/domain/transcription/ would have; times here are seconds, the app would
// use integer milliseconds).
//
// Rules, in order:
//  1. Turns are sorted by start. Speakers are named "Speaker A", "Speaker B", ... in order of
//     FIRST APPEARANCE in the meeting, so labels do not depend on the clustering ids.
//  2. A segment gets the speaker whose turns overlap it the longest (summed over all of that
//     speaker's turns).
//  3. Tie (equal overlap): the speaker whose turn covers the segment start; still tied: the
//     earlier-appearing speaker.
//  4. Gap (no turn overlaps the segment): the nearest turn if it lies within `maxGap` seconds;
//     otherwise the speaker of the previous segment; the very first segment falls back to null
//     (the caller keeps "Speaker 1").
//  5. `mixed` is set when a second speaker covers at least `mixedShare` of the segment, so the
//     review screen can show "speakers uncertain" instead of a confident wrong label.

export function labelFor(index) {
  return index < 26 ? `Speaker ${String.fromCharCode(65 + index)}` : `Speaker ${String(index + 1)}`;
}

/** @param {{speaker:string,start:number,end:number}[]} turns */
export function nameSpeakersByFirstAppearance(turns) {
  const order = new Map();
  for (const t of [...turns].sort((a, b) => a.start - b.start || a.end - b.end)) {
    if (!order.has(t.speaker)) order.set(t.speaker, labelFor(order.size));
  }
  return turns.map((t) => ({ ...t, label: order.get(t.speaker) }));
}

/**
 * @param {{startMs?:number,endMs?:number,start?:number,end?:number}[]} segments  meeting-relative
 * @param {{speaker:string,start:number,end:number}[]} turns  seconds from the start of the audio
 * @returns {{label:string|null, mixed:boolean, overlap:number}[]} one entry per segment, same order
 */
export function assignSpeakers(segments, turns, { maxGap = 1.0, mixedShare = 0.25 } = {}) {
  const named = nameSpeakersByFirstAppearance(turns);
  const rank = new Map();
  for (const t of [...named].sort((a, b) => a.start - b.start)) {
    if (!rank.has(t.label)) rank.set(t.label, rank.size);
  }
  const out = [];
  let previous = null;
  for (const seg of segments) {
    const start = seg.start ?? seg.startMs / 1000;
    const end = Math.max(start, seg.end ?? seg.endMs / 1000);
    const per = new Map();
    for (const t of named) {
      const o = Math.min(end, t.end) - Math.max(start, t.start);
      if (o > 0) per.set(t.label, (per.get(t.label) ?? 0) + o);
    }
    let label;
    let mixed = false;
    let overlap = 0;
    if (per.size > 0) {
      const ranked = [...per.entries()].sort((a, b) => {
        if (Math.abs(b[1] - a[1]) > 1e-6) return b[1] - a[1];
        const covers = (l) => named.some((t) => t.label === l && t.start <= start && t.end > start);
        if (covers(a[0]) !== covers(b[0])) return covers(a[0]) ? -1 : 1;
        return rank.get(a[0]) - rank.get(b[0]);
      });
      [label, overlap] = ranked[0];
      const len = Math.max(end - start, 1e-6);
      mixed = ranked.length > 1 && ranked[1][1] / len >= mixedShare;
    } else {
      let best = null;
      const mid = (start + end) / 2;
      for (const t of named) {
        const d = mid < t.start ? t.start - mid : mid > t.end ? mid - t.end : 0;
        if (best === null || d < best.d) best = { d, label: t.label };
      }
      label = best !== null && best.d <= maxGap + (end - start) / 2 ? best.label : previous;
    }
    if (label !== null) previous = label;
    out.push({ label, mixed, overlap: +overlap.toFixed(3) });
  }
  return out;
}

/**
 * Clustering sometimes leaves a few tiny "speakers" (a cough, one short interjection, noise) next
 * to the real ones. Keeps the speakers that hold enough speech (or exactly the `expected` biggest
 * ones when the owner gave a count) and hands every turn of the others to the speaker of the
 * nearest kept turn in time (previous one on a tie). Adjacent turns of one speaker are merged.
 * @param {{speaker:string,start:number,end:number}[]} turns
 */
export function consolidateSpeakers(
  turns,
  { expected = null, minShare = 0.05, minSeconds = 8 } = {},
) {
  const total = new Map();
  for (const t of turns) total.set(t.speaker, (total.get(t.speaker) ?? 0) + t.end - t.start);
  const all = [...total.values()].reduce((a, b) => a + b, 0);
  const bySize = [...total.entries()].sort((a, b) => b[1] - a[1]);
  const kept = new Set(
    expected !== null
      ? bySize.slice(0, expected).map(([s]) => s)
      : bySize.filter(([, s]) => s >= Math.max(minSeconds, minShare * all)).map(([n]) => n),
  );
  if (kept.size === 0 && bySize.length > 0) kept.add(bySize[0][0]);
  const sorted = [...turns].sort((a, b) => a.start - b.start);
  const keptTurns = sorted.filter((t) => kept.has(t.speaker));
  const out = sorted.map((t) => {
    if (kept.has(t.speaker)) return { ...t };
    // A kept speaker talking at the same time wins: the tiny turn is most likely a piece of it.
    let overlapped = null;
    for (const k of keptTurns) {
      const o = Math.min(t.end, k.end) - Math.max(t.start, k.start);
      if (o > 0 && (overlapped === null || o > overlapped.o))
        overlapped = { o, speaker: k.speaker };
    }
    if (overlapped !== null) return { ...t, speaker: overlapped.speaker };
    const mid = (t.start + t.end) / 2;
    let prev = null;
    let next = null;
    for (const k of keptTurns) {
      if (k.end <= mid) prev = k;
      else if (k.start >= mid && next === null) next = k;
    }
    const dPrev = prev ? t.start - prev.end : Infinity;
    const dNext = next ? next.start - t.end : Infinity;
    const to = dPrev <= dNext ? prev : next;
    return { ...t, speaker: to ? to.speaker : [...kept][0] };
  });
  const merged = [];
  for (const t of out) {
    const last = merged.at(-1);
    if (last && last.speaker === t.speaker && t.start - last.end < 0.5)
      last.end = Math.max(last.end, t.end);
    else merged.push({ ...t });
  }
  return merged;
}

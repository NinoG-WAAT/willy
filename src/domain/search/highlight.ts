export interface HighlightSegment {
  text: string;
  hit: boolean;
}

/** Private-use characters: never produced by text normalization, never typed by an owner. */
export const HIT_START = "\uE000";
export const HIT_END = "\uE001";

export interface Markers {
  start: string;
  end: string;
}

/**
 * Splits an index snippet into plain and matched segments. The result is data, not markup: the
 * page renders each segment as a text node, so stored text can never inject HTML. The adapter
 * passes per-query markers (a random nonce inside them), so markers that happen to be in stored
 * text cannot forge a highlight.
 */
export function highlightSegments(
  snippet: string,
  markers: Markers = { start: HIT_START, end: HIT_END },
): HighlightSegment[] {
  const segments: HighlightSegment[] = [];
  let hit = false;
  let rest = snippet;
  const push = (text: string, isHit: boolean): void => {
    if (text !== "") segments.push({ text, hit: isHit });
  };
  while (rest !== "") {
    const next = hit ? markers.end : markers.start;
    const other = hit ? markers.start : markers.end;
    const at = rest.indexOf(next);
    const stray = rest.indexOf(other);
    if (at === -1 && stray === -1) {
      push(rest, hit);
      break;
    }
    if (at !== -1 && (stray === -1 || at < stray)) {
      push(rest.slice(0, at), hit);
      rest = rest.slice(at + next.length);
      hit = !hit;
    } else {
      // A marker that does not fit the current state is dropped; the text around it is kept.
      push(rest.slice(0, stray), hit);
      rest = rest.slice(stray + other.length);
    }
  }
  return segments;
}

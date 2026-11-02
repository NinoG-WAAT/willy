import { formatOffset } from "./review";

/** Nesting below the top level, at most two levels deep (so three visual levels). */
export type OutlineDepth = 0 | 1 | 2;

export interface OutlineItem {
  text: string;
  depth: OutlineDepth;
}

/**
 * A section body as data. Every string is plain text: the page renders it as text nodes (Astro's
 * default escaping), so a body can never inject HTML, links or script, and nothing here is Markdown.
 * A list block keeps the kind of its first top-level marker; nested items (any marker) stay in it.
 */
export type OutlineBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "bullets"; items: OutlineItem[] }
  | { kind: "numbered"; items: OutlineItem[] };

type ListKind = "bullets" | "numbered";

const DEPTHS: readonly OutlineDepth[] = [0, 1, 2];
const MAX_LEVELS = DEPTHS.length;
/** "2026. Plans" reads as a sentence, "12. step" as a list: a marker is at most three digits. */
const MAX_MARKER_DIGITS = 3;
/** A tab is wider than a space, but only the order of indents matters, not their width. */
const TAB_WIDTH = 4;
const FALLBACK_LABEL = "Source in the transcript";

const isBlank = (c: string | undefined): boolean => c === " " || c === "\t";
const isDigit = (c: string | undefined): boolean => c !== undefined && c >= "0" && c <= "9";

/** Marker with its text, "empty" for a marker with nothing after it, or null for plain text. */
function readMarker(line: string): { kind: ListKind; text: string } | "empty" | null {
  const first = line[0];
  if (first === "•") return itemOf("bullets", line.slice(1));
  if (first === "-" || first === "*") {
    // "-5 degrees" and "*emphasis*" are prose: a dash or star needs a space after it.
    if (line.length === 1) return "empty";
    return isBlank(line[1]) ? itemOf("bullets", line.slice(1)) : null;
  }
  let digits = 0;
  while (digits <= MAX_MARKER_DIGITS && isDigit(line[digits])) digits += 1;
  if (digits === 0 || digits > MAX_MARKER_DIGITS) return null;
  const mark = line[digits];
  // A lone "2026." is kept as text, never dropped: it may be the whole point of the line.
  if ((mark !== "." && mark !== ")") || !isBlank(line[digits + 1])) return null;
  return itemOf("numbered", line.slice(digits + 1));
}

function itemOf(kind: ListKind, rest: string): { kind: ListKind; text: string } | "empty" {
  const text = rest.trim();
  return text === "" ? "empty" : { kind, text };
}

function indentOf(line: string): number {
  let width = 0;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (c === " ") width += 1;
    else if (c === "\t") width += TAB_WIDTH;
    else break;
  }
  return width;
}

/**
 * Splits a body into paragraphs, bullet lists and numbered lists. One pass over the lines, no
 * regular expressions and no look-back, so the work is linear in the body whatever it contains.
 * Depth is relative (a deeper indent is one level down, however many spaces it uses) and capped,
 * which handles both two- and four-space models. A blank line ends a block, a plain line ends a
 * list, and a marker with no text is dropped rather than shown as an empty bullet.
 */
export function parseOutline(body: string): OutlineBlock[] {
  const blocks: OutlineBlock[] = [];
  const lines = body.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
  let paragraph: string[] = [];
  let list: { kind: ListKind; items: OutlineItem[] } | null = null;
  /** Indents of the open levels, outermost first; at most MAX_LEVELS long. */
  let levels: number[] = [];

  const endParagraph = (): void => {
    if (paragraph.length > 0) blocks.push({ kind: "paragraph", text: paragraph.join("\n") });
    paragraph = [];
  };
  const endList = (): void => {
    list = null;
    levels = [];
  };

  for (const line of lines) {
    const indent = indentOf(line);
    const content = line.trim();
    if (content === "") {
      endParagraph();
      endList();
      continue;
    }
    const marker = readMarker(content);
    if (marker === "empty") continue;
    if (marker === null) {
      endList();
      paragraph.push(content);
      continue;
    }

    endParagraph();
    while (levels.length > 0 && (levels[levels.length - 1] ?? 0) > indent) levels.pop();
    if (levels.length === 0 || (levels[levels.length - 1] ?? 0) < indent) {
      if (levels.length < MAX_LEVELS) levels.push(indent);
    }
    const depth = DEPTHS[levels.length - 1] ?? 2;

    if (list === null || (depth === 0 && list.kind !== marker.kind)) {
      list = { kind: marker.kind, items: [] };
      blocks.push(list);
    }
    list.items.push({ text: marker.text, depth });
  }
  endParagraph();
  return blocks;
}

/** One list item with the items nested under it, for rendering real nested lists. */
export interface OutlineNode {
  text: string;
  children: OutlineNode[];
}

/**
 * Turns the flat, depth-tagged items of a list block into a tree. An item goes under the nearest
 * item above it that is shallower, so a level that skips one is attached rather than dropped, and
 * a first item that starts deeper is simply top level.
 */
export function nestItems(items: readonly OutlineItem[]): OutlineNode[] {
  const roots: OutlineNode[] = [];
  /** The open path: the last node of each level, outermost first, with its depth. */
  const path: { depth: number; node: OutlineNode }[] = [];
  for (const item of items) {
    while (path.length > 0 && (path[path.length - 1]?.depth ?? 0) >= item.depth) path.pop();
    const node: OutlineNode = { text: item.text, children: [] };
    const parent = path[path.length - 1];
    if (parent) parent.node.children.push(node);
    else roots.push(node);
    path.push({ depth: item.depth, node });
  }
  return roots;
}

/**
 * Writes blocks back as a body that `parseOutline` reads to the same blocks (two spaces per
 * level, `- ` and `1.` markers, a blank line between blocks). Used when the owner edits a body
 * that was produced from blocks, so a save never drifts the structure.
 */
export function serializeOutline(blocks: OutlineBlock[]): string {
  return blocks
    .map((block) => {
      if (block.kind === "paragraph") return block.text;
      const counters = [0, 0, 0];
      return block.items
        .map((item) => {
          // One item is one line: a stray newline would otherwise start a new block on re-parse.
          const text = item.text
            .split(/[\r\n]+/)
            .map((part) => part.trim())
            .filter((part) => part !== "")
            .join(" ");
          const pad = "  ".repeat(item.depth);
          if (block.kind === "bullets") return `${pad}- ${text}`;
          counters[item.depth] = (counters[item.depth] ?? 0) + 1;
          for (let deeper = item.depth + 1; deeper < MAX_LEVELS; deeper += 1) counters[deeper] = 0;
          return `${pad}${String(counters[item.depth])}. ${text}`;
        })
        .join("\n");
    })
    .filter((part) => part !== "")
    .join("\n\n");
}

/**
 * The text of a source chip: '2:10' for one point, '2:10 to 3:45' for a range, and a plain
 * fallback when the range is missing or a time is unknown. `timeOf` maps a transcript position to
 * its start in milliseconds; the formatter is the one the transcript lines use.
 */
export function sourceLabel(
  from: number | null,
  to: number | null,
  timeOf: (position: number) => number | undefined,
): string {
  if (from === null || to === null) return FALLBACK_LABEL;
  const start = timeOf(from);
  const end = timeOf(to);
  if (start === undefined || end === undefined) return FALLBACK_LABEL;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return FALLBACK_LABEL;
  const a = formatOffset(start);
  const b = formatOffset(end);
  return from === to || a === b ? a : `${a} to ${b}`;
}

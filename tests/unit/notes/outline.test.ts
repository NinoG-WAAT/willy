import { describe, expect, it } from "vitest";
import {
  parseOutline,
  serializeOutline,
  sourceLabel,
  type OutlineBlock,
  type OutlineDepth,
  type OutlineItem,
} from "../../../src/domain/notes/outline";

type Spec = [text: string, depth?: OutlineDepth];
const items = (specs: Spec[]): OutlineItem[] =>
  specs.map(([text, depth]) => ({ text, depth: depth ?? 0 }));
const bullets = (...specs: Spec[]): OutlineBlock => ({ kind: "bullets", items: items(specs) });
const numbered = (...specs: Spec[]): OutlineBlock => ({ kind: "numbered", items: items(specs) });

describe("parseOutline: paragraphs", () => {
  it("returns no blocks for an empty or blank body", () => {
    expect(parseOutline("")).toEqual([]);
    expect(parseOutline("  \n \n\t\n")).toEqual([]);
  });

  it("keeps one paragraph for plain text", () => {
    expect(parseOutline("We agreed to ship on Friday.")).toEqual([
      { kind: "paragraph", text: "We agreed to ship on Friday." },
    ]);
  });

  it("separates paragraphs on blank lines, however many", () => {
    expect(parseOutline("One.\n\n\n\nTwo.\n  \nThree.")).toEqual([
      { kind: "paragraph", text: "One." },
      { kind: "paragraph", text: "Two." },
      { kind: "paragraph", text: "Three." },
    ]);
  });

  it("keeps soft line breaks inside a paragraph and trims each line", () => {
    expect(parseOutline("  first line  \n second line")).toEqual([
      { kind: "paragraph", text: "first line\nsecond line" },
    ]);
  });

  it("does not treat a marker glued to its text as a list", () => {
    expect(parseOutline("-5 degrees\n*emphasis*\n3.5 million\n**bold**")).toEqual([
      { kind: "paragraph", text: "-5 degrees\n*emphasis*\n3.5 million\n**bold**" },
    ]);
  });
});

describe("parseOutline: bullet lists", () => {
  it("reads the three bullet markers, mixed in one list", () => {
    expect(parseOutline("- one\n* two\n• three\n•four")).toEqual([
      bullets(["one"], ["two"], ["three"], ["four"]),
    ]);
  });

  it("handles a body that is only bullets", () => {
    expect(parseOutline("- a\n- b\n- c")).toEqual([bullets(["a"], ["b"], ["c"])]);
  });

  it("splits a paragraph from the list that follows it, with or without a blank line", () => {
    const expected = [{ kind: "paragraph", text: "Risks:" }, bullets(["late"], ["costly"])];
    expect(parseOutline("Risks:\n- late\n- costly")).toEqual(expected);
    expect(parseOutline("Risks:\n\n- late\n- costly")).toEqual(expected);
  });

  it("ends a list at a blank line", () => {
    expect(parseOutline("- a\n\n- b")).toEqual([bullets(["a"]), bullets(["b"])]);
  });

  it("ends a list at a plain line and starts a paragraph", () => {
    expect(parseOutline("- a\nafter")).toEqual([
      bullets(["a"]),
      { kind: "paragraph", text: "after" },
    ]);
  });

  it("drops a marker with no text instead of rendering an empty bullet", () => {
    expect(parseOutline("-")).toEqual([]);
    expect(parseOutline("- \n•\n*")).toEqual([]);
    expect(parseOutline("- a\n-\n- b")).toEqual([bullets(["a"], ["b"])]);
  });
});

describe("parseOutline: numbered lists", () => {
  it("reads 1. and 1) markers and ignores the actual numbers", () => {
    expect(parseOutline("1. first\n2) second\n7. third")).toEqual([
      numbered(["first"], ["second"], ["third"]),
    ]);
  });

  it("starts a new block when the marker kind changes at the top level", () => {
    expect(parseOutline("1. a\n- b\n2. c")).toEqual([
      numbered(["a"]),
      bullets(["b"]),
      numbered(["c"]),
    ]);
  });

  it("keeps a lone number marker as text rather than losing it", () => {
    expect(parseOutline("2026.")).toEqual([{ kind: "paragraph", text: "2026." }]);
    expect(parseOutline("1)")).toEqual([{ kind: "paragraph", text: "1)" }]);
  });

  it("does not read a long digit run as a marker", () => {
    expect(parseOutline("12345. Plans")).toEqual([{ kind: "paragraph", text: "12345. Plans" }]);
  });
});

describe("parseOutline: nesting", () => {
  it("derives depth from leading spaces, two per level", () => {
    expect(parseOutline("- a\n  - b\n    - c\n- d")).toEqual([
      bullets(["a", 0], ["b", 1], ["c", 2], ["d", 0]),
    ]);
  });

  it("copes with four spaces per level", () => {
    expect(parseOutline("- a\n    - b\n        - c")).toEqual([
      bullets(["a", 0], ["b", 1], ["c", 2]),
    ]);
  });

  it("caps depth at 2", () => {
    const body = "- a\n  - b\n    - c\n      - d\n        - e";
    expect(parseOutline(body)).toEqual([bullets(["a", 0], ["b", 1], ["c", 2], ["d", 2], ["e", 2])]);
  });

  it("never jumps more than one level at a time", () => {
    expect(parseOutline("- a\n          - b")).toEqual([bullets(["a", 0], ["b", 1])]);
  });

  it("treats a first item that is indented as top level", () => {
    expect(parseOutline("    - a\n    - b")).toEqual([bullets(["a"], ["b"])]);
  });

  it("returns to an earlier level when indentation shrinks", () => {
    expect(parseOutline("- a\n    - b\n  - c\n- d")).toEqual([
      bullets(["a", 0], ["b", 1], ["c", 1], ["d", 0]),
    ]);
  });

  it("nests under a numbered list whatever the nested marker, keeping one block", () => {
    expect(parseOutline("1. step\n   - detail\n   1. more\n2. next")).toEqual([
      numbered(["step", 0], ["detail", 1], ["more", 1], ["next", 0]),
    ]);
  });

  it("counts a tab as indentation", () => {
    expect(parseOutline("- a\n\t- b")).toEqual([bullets(["a", 0], ["b", 1])]);
  });
});

describe("parseOutline: newlines", () => {
  it("tolerates Windows and old Mac newlines", () => {
    const expected = [{ kind: "paragraph", text: "Intro" }, bullets(["a"], ["b"]), numbered(["c"])];
    expect(parseOutline("Intro\r\n- a\r\n- b\r\n\r\n1. c\r\n")).toEqual(expected);
    expect(parseOutline("Intro\r- a\r- b\r\r1. c\r")).toEqual(expected);
  });
});

describe("parseOutline: hostile text stays plain text", () => {
  const texts = (blocks: OutlineBlock[]): string[] =>
    blocks.flatMap((b) => (b.kind === "paragraph" ? [b.text] : b.items.map((i) => i.text)));

  it("keeps HTML tags as literal characters", () => {
    const body = '<script>alert(1)</script>\n- <img src=x onerror="alert(1)">\n1. <b>bold</b>';
    expect(texts(parseOutline(body))).toEqual([
      "<script>alert(1)</script>",
      '<img src=x onerror="alert(1)">',
      "<b>bold</b>",
    ]);
  });

  it("does not turn Markdown links or images into anything", () => {
    const body = "[click](javascript:alert(1))\n- ![x](http://evil.example/p.png)";
    expect(texts(parseOutline(body))).toEqual([
      "[click](javascript:alert(1))",
      "![x](http://evil.example/p.png)",
    ]);
  });

  it("keeps javascript: and data: URLs as text", () => {
    expect(
      texts(parseOutline("- javascript:alert(document.cookie)\n- data:text/html,<p>x</p>")),
    ).toEqual(["javascript:alert(document.cookie)", "data:text/html,<p>x</p>"]);
  });

  it("produces only plain data: known keys, strings and small integers", () => {
    const blocks = parseOutline("hi\n- a\n  - b\n1. c");
    expect(JSON.parse(JSON.stringify(blocks))).toEqual(blocks);
    for (const block of blocks) {
      expect(["paragraph", "bullets", "numbered"]).toContain(block.kind);
      expect(Object.keys(block).sort()).toEqual(
        block.kind === "paragraph" ? ["kind", "text"] : ["items", "kind"],
      );
      if (block.kind !== "paragraph") {
        for (const item of block.items) {
          expect(Object.keys(item).sort()).toEqual(["depth", "text"]);
          expect([0, 1, 2]).toContain(item.depth);
        }
      }
    }
  });

  it("handles 20000 dashes on one line as a paragraph, quickly", () => {
    const started = performance.now();
    const blocks = parseOutline("-".repeat(20_000));
    expect(blocks).toEqual([{ kind: "paragraph", text: "-".repeat(20_000) }]);
    expect(performance.now() - started).toBeLessThan(500);
  });

  it("handles 20000 characters of dash-space as one bullet", () => {
    const body = "- ".repeat(10_000);
    const blocks = parseOutline(body);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.kind).toBe("bullets");
  });

  it("handles 20000 characters of one-dash lines without losing time", () => {
    const started = performance.now();
    expect(parseOutline("-\n".repeat(10_000))).toEqual([]);
    expect(performance.now() - started).toBeLessThan(500);
  });

  it("handles 20000 characters of nested bullets", () => {
    const started = performance.now();
    const blocks = parseOutline("- x\n".repeat(5_000));
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.kind === "bullets" && blocks[0].items.length).toBe(5_000);
    expect(performance.now() - started).toBeLessThan(500);
  });

  it("handles a 20000-character single line of text", () => {
    const line = "word ".repeat(4_000).trim();
    expect(parseOutline(line)).toEqual([{ kind: "paragraph", text: line }]);
  });

  it("handles very deep indentation", () => {
    const started = performance.now();
    const body = `${" ".repeat(19_000)}- deep\n- shallow\n${" ".repeat(900)}- again`;
    expect(parseOutline(body)).toEqual([bullets(["deep", 0], ["shallow", 0], ["again", 1])]);
    expect(performance.now() - started).toBeLessThan(500);
  });

  it("handles indentation that grows on every line", () => {
    const body = Array.from({ length: 150 }, (_, i) => `${" ".repeat(i)}- n${String(i)}`).join(
      "\n",
    );
    const blocks = parseOutline(body);
    expect(blocks).toHaveLength(1);
    const depths = blocks[0]?.kind === "bullets" ? blocks[0].items.map((i) => i.depth) : [];
    expect(Math.max(...depths)).toBe(2);
    expect(depths.slice(0, 4)).toEqual([0, 1, 2, 2]);
  });
});

describe("serializeOutline", () => {
  it("writes blocks separated by a blank line", () => {
    expect(
      serializeOutline([
        { kind: "paragraph", text: "Intro" },
        bullets(["a", 0], ["b", 1]),
        numbered(["x", 0], ["y", 0], ["z", 1], ["w", 0]),
      ]),
    ).toBe("Intro\n\n- a\n  - b\n\n1. x\n2. y\n  1. z\n3. w");
  });

  it("returns an empty body for no blocks", () => {
    expect(serializeOutline([])).toBe("");
  });

  it("keeps an item on one line", () => {
    expect(serializeOutline([bullets(["a\nb"])])).toBe("- a b");
  });
});

describe("round trip", () => {
  const bodies = [
    "",
    "Just text.",
    "One.\n\nTwo.\nstill two",
    "- a\n* b\n• c",
    "1. a\n2) b\n3. c",
    "- a\n    - b\n        - c\n            - d\n- e",
    "Intro\n- a\n  - b\n1. x\n   - y\n2. z\n\nOutro\n-\n2026.",
    "Intro\r\n- a\r\n  - b\r\n\r\nEnd",
    "- - nested marker text\n1. 1. nested number text\n- 2. mixed",
    "<b>x</b>\n- [l](javascript:alert(1))",
    "-".repeat(20_000),
    "- ".repeat(10_000),
    "-\n".repeat(100),
    "- a\n          - b\n- c",
    "    - a\n  - b\n- c",
  ];

  it.each(bodies.map((body, i) => [i, body] as const))(
    "parse(serialize(parse(x))) equals parse(x), body %i",
    (_i, body) => {
      const once = parseOutline(body);
      expect(parseOutline(serializeOutline(once))).toEqual(once);
    },
  );

  it("is stable after the first pass (serialize is a fixed point)", () => {
    for (const body of bodies) {
      const text = serializeOutline(parseOutline(body));
      expect(serializeOutline(parseOutline(text))).toBe(text);
    }
  });
});

describe("sourceLabel", () => {
  const times = new Map([
    [3, 130_000],
    [9, 225_000],
    [10, 130_400],
  ]);
  const timeOf = (position: number): number | undefined => times.get(position);

  it("shows one time for a single point", () => {
    expect(sourceLabel(3, 3, timeOf)).toBe("2:10");
  });

  it("shows a range with 'to'", () => {
    expect(sourceLabel(3, 9, timeOf)).toBe("2:10 to 3:45");
  });

  it("collapses a range whose ends read the same", () => {
    expect(sourceLabel(3, 10, timeOf)).toBe("2:10");
  });

  it("uses hours past the first hour", () => {
    expect(sourceLabel(1, 1, () => 3_723_000)).toBe("1:02:03");
  });

  it("falls back when a time is unknown on either end", () => {
    expect(sourceLabel(3, 4, timeOf)).toBe("Source in the transcript");
    expect(sourceLabel(4, 9, timeOf)).toBe("Source in the transcript");
    expect(sourceLabel(4, 4, timeOf)).toBe("Source in the transcript");
  });

  it("falls back when the source range is missing", () => {
    expect(sourceLabel(null, null, timeOf)).toBe("Source in the transcript");
    expect(sourceLabel(3, null, timeOf)).toBe("Source in the transcript");
    expect(sourceLabel(null, 9, timeOf)).toBe("Source in the transcript");
  });

  it("falls back for a time that is not a finite number", () => {
    expect(sourceLabel(1, 1, () => Number.NaN)).toBe("Source in the transcript");
  });
});

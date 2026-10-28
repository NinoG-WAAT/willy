import { describe, expect, it } from "vitest";
import { HIT_END, HIT_START, highlightSegments } from "../../../src/domain/search/highlight";

const s = HIT_START;
const e = HIT_END;

describe("highlightSegments", () => {
  it("turns marker pairs into hit segments and keeps the text between", () => {
    expect(highlightSegments(`ship the ${s}beta${e} in ${s}Nov${e}ember`)).toEqual([
      { text: "ship the ", hit: false },
      { text: "beta", hit: true },
      { text: " in ", hit: false },
      { text: "Nov", hit: true },
      { text: "ember", hit: false },
    ]);
  });

  it("returns one plain segment when nothing matched, and nothing for empty text", () => {
    expect(highlightSegments("plain text")).toEqual([{ text: "plain text", hit: false }]);
    expect(highlightSegments("")).toEqual([]);
  });

  it("never interprets markup: user text stays text (the page renders segments as text nodes)", () => {
    const segments = highlightSegments(`<img src=x onerror=1>${s}<script>${e}`);
    expect(segments).toEqual([
      { text: "<img src=x onerror=1>", hit: false },
      { text: "<script>", hit: true },
    ]);
  });

  it("survives stray or unbalanced markers without throwing or losing text", () => {
    const joined = (raw: string) =>
      highlightSegments(raw)
        .map((x) => x.text)
        .join("");
    expect(joined(`a${e}b${s}c`)).toBe("abc");
    expect(joined(`${s}${s}x${e}${e}`)).toBe("x");
  });

  it("uses markers that cannot appear in normalized text", () => {
    expect(HIT_START).not.toBe(HIT_END);
    expect(/\p{Cc}/u.test(HIT_START) || /\p{Co}/u.test(HIT_START)).toBe(true);
  });
});

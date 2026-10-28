import { describe, expect, it } from "vitest";
import {
  MAX_TERMS,
  MAX_TERM_CHARS,
  buildMatchExpression,
  parseSearchQuery,
} from "../../../src/domain/search/query";

const terms = (raw: unknown): string[] => {
  const result = parseSearchQuery(raw);
  return result.ok ? result.value : [];
};

describe("parseSearchQuery", () => {
  it("splits on whitespace, normalizes to NFC and keeps the words", () => {
    expect(terms("  roadmap \t beta\n")).toEqual(["roadmap", "beta"]);
    expect(terms("Café")).toEqual(["Café"]);
  });

  it("removes characters that mean something to the index so input is never syntax", () => {
    expect(terms('he said "ship it" (now)*')).toEqual(["he", "said", "ship", "it", "now"]);
    expect(terms("a:b NEAR(x y) - ^caret {x} OR AND NOT")).toEqual([
      "a",
      "b",
      "NEAR",
      "x",
      "y",
      "caret",
      "x",
      "OR",
      "AND",
      "NOT",
    ]);
  });

  it("keeps hyphenated and apostrophe words readable", () => {
    expect(terms("follow-up o'brien")).toEqual(["follow", "up", "o", "brien"]);
  });

  it("requires at least one real word", () => {
    for (const raw of ["", "   ", '"" ** ()', undefined, null, 5]) {
      expect(parseSearchQuery(raw)).toMatchObject({ ok: false, error: { field: "q" } });
    }
  });

  it("limits the number and length of terms instead of failing silently", () => {
    const many = Array.from({ length: MAX_TERMS + 3 }, (_, i) => `word${String(i)}`).join(" ");
    expect(parseSearchQuery(many)).toMatchObject({ ok: false, error: { field: "q" } });
    expect(parseSearchQuery("x".repeat(MAX_TERM_CHARS + 1))).toMatchObject({ ok: false });
    expect(parseSearchQuery("x".repeat(MAX_TERM_CHARS)).ok).toBe(true);
  });
});

describe("buildMatchExpression", () => {
  it("quotes every term and makes each a prefix, joined by an implicit AND", () => {
    expect(buildMatchExpression(["roadmap", "beta"])).toBe('"roadmap"* "beta"*');
  });

  it("can never produce an operator, column filter or unbalanced quote", () => {
    const expression = buildMatchExpression(["OR", "NEAR", "title"]);
    expect(expression).toBe('"OR"* "NEAR"* "title"*');
    expect(expression.match(/"/g)?.length).toBe(6);
  });
});

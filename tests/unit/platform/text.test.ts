import { describe, expect, it } from "vitest";
import { normalizeLine, normalizeMultiline } from "../../../src/domain/platform/text";

describe("normalizeLine", () => {
  it("trims, collapses whitespace and normalizes to NFC", () => {
    expect(normalizeLine("  Weekly \t  sync ")).toBe("Weekly sync");
    expect(normalizeLine("Café")).toBe("Café");
  });

  it("turns control characters and newlines into spaces", () => {
    expect(normalizeLine("a\u0000b\nc\rd")).toBe("a b c d");
  });

  it("returns null for anything that is not text", () => {
    expect(normalizeLine(null)).toBeNull();
    expect(normalizeLine(42)).toBeNull();
    expect(normalizeLine(undefined)).toBeNull();
  });
});

describe("normalizeMultiline", () => {
  it("keeps line breaks, unifies CRLF, strips control characters, trims", () => {
    expect(normalizeMultiline("  one\r\ntwo\u0000\n\n\n\nthree  ")).toBe("one\ntwo\n\nthree");
  });

  it("normalizes to NFC and rejects non-text", () => {
    expect(normalizeMultiline("Café")).toBe("Café");
    expect(normalizeMultiline({})).toBeNull();
  });
});

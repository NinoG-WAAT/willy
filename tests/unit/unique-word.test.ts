import { describe, expect, it } from "vitest";
import { uniqueWord } from "../support/unique-word";

// Search matches prefixes, so two words only stay apart if neither starts with the other.
// Playwright workers build their words independently and at nearly the same instant (#47, #48).
describe("uniqueWord", () => {
  const words = Array.from({ length: 5_000 }, () => uniqueWord("desktop"));

  it("never repeats, even when asked many times in the same millisecond", () => {
    expect(new Set(words).size).toBe(words.length);
  });

  it("is letters only, because search treats digits and punctuation as word breaks", () => {
    for (const word of words) expect(word).toMatch(/^[a-z]+$/);
  });

  it("has one fixed length per project, so one word is never a prefix of another", () => {
    expect(new Set(words.map((w) => w.length)).size).toBe(1);
  });

  it("keeps the two projects apart", () => {
    const phone = uniqueWord("phone");
    expect(words.some((w) => w.startsWith(phone) || phone.startsWith(w))).toBe(false);
  });
});

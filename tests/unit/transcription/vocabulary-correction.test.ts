import { describe, expect, it } from "vitest";
import {
  boundedVocabulary,
  correctWithVocabulary,
  MAX_CORRECTION_TEXT_LENGTH,
  MAX_VOCABULARY_TERM_LENGTH,
  MAX_VOCABULARY_TERMS,
  squashForMatching,
} from "../../../src/domain/transcription/vocabulary-correction";

const TERMS = ["SALSA", "Sitetracker", "go-live"];
const fix = (text: string, terms: readonly string[] = TERMS): string =>
  correctWithVocabulary(text, terms);

describe("squashForMatching", () => {
  it("ignores case, spaces, hyphens, apostrophes (straight and curly) and accents", () => {
    for (const form of ["Site Tracker", "site-tracker", "SITETRACKER", "Site‑Tracker"]) {
      expect(squashForMatching(form)).toBe("sitetracker");
    }
    expect(squashForMatching("L'Équipe")).toBe("lequipe");
    expect(squashForMatching("L’Équipe")).toBe("lequipe");
    expect(squashForMatching("Amélie")).toBe("amelie");
    expect(squashForMatching("Amélie")).toBe("amelie");
  });

  it("keeps everything else, so 'C++' and 'C' stay different", () => {
    expect(squashForMatching("C++")).toBe("c++");
    expect(squashForMatching("a.b*")).toBe("a.b*");
  });
});

describe("correctWithVocabulary: the owner's spelling", () => {
  it("fixes capitals: 'Salsa' becomes 'SALSA'", () => {
    expect(fix("We use Salsa daily.")).toBe("We use SALSA daily.");
    expect(fix("salsa and SALSA and sAlSa")).toBe("SALSA and SALSA and SALSA");
  });

  it("joins words: 'site tracker' becomes 'Sitetracker'", () => {
    expect(fix("Open the site tracker now")).toBe("Open the Sitetracker now");
    expect(fix("Open the SiteTracker now")).toBe("Open the Sitetracker now");
  });

  it("matches hyphenated variants: 'Site-Tracker' becomes 'Sitetracker'", () => {
    expect(fix("the Site-Tracker report")).toBe("the Sitetracker report");
  });

  it("joins or splits to the listed form: 'go live' and 'GO-LIVE' become 'go-live'", () => {
    expect(fix("the go live is Friday")).toBe("the go-live is Friday");
    expect(fix("the GO-LIVE is Friday")).toBe("the go-live is Friday");
    expect(fix("the Go Live is Friday")).toBe("the go-live is Friday");
  });

  it("leaves a word that is already spelled right alone", () => {
    const text = "SALSA, Sitetracker and go-live";
    expect(fix(text)).toBe(text);
  });

  it("matches ignoring accents in both directions", () => {
    expect(fix("hello amelie!", ["Amélie"])).toBe("hello Amélie!");
    expect(fix("hello AMÉLIE!", ["Amélie"])).toBe("hello Amélie!");
    expect(fix("hello Amélie!", ["amelie"])).toBe("hello amelie!");
    expect(fix("hello Amélie!", ["Amélie"])).toBe("hello Amélie!");
  });

  it("matches straight and curly apostrophes alike", () => {
    expect(fix("chez l’équipe", ["L'Équipe"])).toBe("chez L'Équipe");
    expect(fix("chez l'equipe", ["L’Équipe"])).toBe("chez L’Équipe");
    expect(fix("chez lequipe", ["L'Équipe"])).toBe("chez L'Équipe");
  });
});

describe("correctWithVocabulary: what is never rewritten", () => {
  it("returns text without any term variant byte-for-byte identical", () => {
    const text = "Nothing to see here.\n\n  Two  spaces, tabs\tand a  nbsp. Salsify, salsas.";
    expect(fix(text)).toBe(text);
  });

  it("does not match a term inside a longer word", () => {
    expect(fix("two salsas, resalsa, salsaverde and unsite tracker")).toBe(
      "two salsas, resalsa, salsaverde and unsite tracker",
    );
    expect(fix("salsa2 and 2salsa and salsa_x")).toBe("salsa2 and 2salsa and SALSA_x");
  });

  it("does not match a term next to its own apostrophe or hyphen suffix (one longer word)", () => {
    expect(fix("Salsa's menu and salsa-verde")).toBe("Salsa's menu and salsa-verde");
  });

  it("treats a term as a word match inside a phrase, deliberately: 'salsa verde' becomes 'SALSA verde'", () => {
    // The owner chose the list; we never judge whether a word is "really" the company word.
    expect(fix("a salsa verde recipe")).toBe("a SALSA verde recipe");
  });

  it("does no fuzzy or phonetic matching", () => {
    expect(fix("salza, sitetraker, golife, silsa, site trackr")).toBe(
      "salza, sitetraker, golife, silsa, site trackr",
    );
  });

  it("does not bridge words across punctuation or line breaks", () => {
    expect(fix("site, tracker")).toBe("site, tracker");
    expect(fix("site. Tracker")).toBe("site. Tracker");
    expect(fix("site\ntracker")).toBe("site\ntracker");
    expect(fix("site - tracker")).toBe("site - tracker");
    expect(fix("site\r\ntracker")).toBe("site\r\ntracker");
  });

  it("does not match a run of more than three words", () => {
    expect(fix("s i t e t r a c k e r")).toBe("s i t e t r a c k e r");
  });

  it("returns the text unchanged for an empty list or an empty text", () => {
    expect(fix("Salsa", [])).toBe("Salsa");
    expect(fix("", TERMS)).toBe("");
    expect(fix("", [])).toBe("");
  });

  it("ignores terms with nothing to match: blank, with a line break, or longer than the limit", () => {
    expect(
      fix("Salsa", ["", "   ", "\n", "SAL\nSA", "x".repeat(MAX_VOCABULARY_TERM_LENGTH + 1)]),
    ).toBe("Salsa");
  });

  it("does not let a term smuggle a line break into the text", () => {
    expect(fix("one two", ["one\ntwo"])).toBe("one two");
    expect(fix("one two", ["one two"])).toBe("one two");
  });
});

describe("correctWithVocabulary: punctuation, spacing and line breaks are preserved", () => {
  it("keeps punctuation attached to the matched words", () => {
    expect(fix('site tracker, salsa. (go live) "Salsa"; salsa?! salsa…')).toBe(
      'Sitetracker, SALSA. (go-live) "SALSA"; SALSA?! SALSA…',
    );
  });

  it("keeps whitespace and line breaks around a match exactly", () => {
    expect(fix("  salsa  \n\tsite tracker\r\n\r\n go live \n")).toBe(
      "  SALSA  \n\tSitetracker\r\n\r\n go-live \n",
    );
  });

  it("matches words separated by several spaces, tabs or no-break spaces", () => {
    expect(fix("site   tracker")).toBe("Sitetracker");
    expect(fix("site\ttracker")).toBe("Sitetracker");
    expect(fix("site tracker")).toBe("Sitetracker");
  });

  it("matches at the very start and the very end of the text", () => {
    expect(fix("salsa")).toBe("SALSA");
    expect(fix("salsa site tracker")).toBe("SALSA Sitetracker");
  });

  it("matches the same term twice in a row and many times", () => {
    expect(fix("salsa salsa")).toBe("SALSA SALSA");
    expect(fix("salsa ".repeat(3).trim())).toBe("SALSA SALSA SALSA");
  });
});

describe("correctWithVocabulary: longest term wins, first term wins a tie", () => {
  it("prefers the longest run of words at a position", () => {
    const terms = ["Site", "Site Tracker Pro", "Tracker", "Sitetracker"];
    // 3 words beat 2 words beat 1 word; the first word alone would also be a term.
    expect(correctWithVocabulary("the site tracker pro tool", terms)).toBe(
      "the Site Tracker Pro tool",
    );
    expect(correctWithVocabulary("the site tracker tool", terms)).toBe("the Sitetracker tool");
    expect(correctWithVocabulary("the site tool, tracker", terms)).toBe("the Site tool, Tracker");
  });

  it("does not rewrite the same words twice when terms overlap", () => {
    const terms = ["Go Live", "Live Demo"];
    expect(correctWithVocabulary("go live demo", terms)).toBe("Go Live demo");
    expect(correctWithVocabulary("live demo", terms)).toBe("Live Demo");
  });

  it("takes the first listed spelling when two terms squash to the same form", () => {
    expect(correctWithVocabulary("go live", ["Go-Live", "golive", "GO LIVE"])).toBe("Go-Live");
    expect(correctWithVocabulary("go live", ["golive", "Go-Live"])).toBe("golive");
  });

  it("handles a multi-word term: 'Plan B' matches one, two or hyphenated words", () => {
    const terms = ["Plan B"];
    expect(correctWithVocabulary("we need plan b now", terms)).toBe("we need Plan B now");
    expect(correctWithVocabulary("we need PLAN-B now", terms)).toBe("we need Plan B now");
    expect(correctWithVocabulary("we need planb now", terms)).toBe("we need Plan B now");
    expect(correctWithVocabulary("plan, b", terms)).toBe("plan, b");
    expect(correctWithVocabulary("plan bee", terms)).toBe("plan bee");
  });

  it("takes the list's spelling for a term that is also a common word, on purpose", () => {
    // The owner chose the list: 'Apple' in the list means every 'apple' word becomes 'Apple'.
    expect(correctWithVocabulary("an apple a day, APPLE pie", ["Apple"])).toBe(
      "an Apple a day, Apple pie",
    );
    expect(correctWithVocabulary("Apple Inc and the apple tree", ["apple"])).toBe(
      "apple Inc and the apple tree",
    );
  });
});

describe("correctWithVocabulary: hostile input", () => {
  it("never builds a pattern from a term: regex metacharacters are plain, inert text", () => {
    const terms = ["C++", "a.b*", "(x)", "[a-z]+", "^$", "\\d{3}", ".*", "a|b", "(a+)+$"];
    const text = "C++ a.b* (x) [a-z]+ ^$ \\d{3} .* a|b (a+)+$ aaaa b x C";
    expect(correctWithVocabulary(text, terms)).toBe(text);
  });

  it("is not confused by metacharacters next to a real term", () => {
    expect(fix("(salsa) [site tracker] {go live} $salsa^ salsa*")).toBe(
      "(SALSA) [Sitetracker] {go-live} $SALSA^ SALSA*",
    );
  });

  it("keeps emoji intact, including variation selectors and ZWJ sequences", () => {
    expect(fix("salsa ❤️ site tracker \u{1F468}‍\u{1F4BB} go live \u{1F680}")).toBe(
      "SALSA ❤️ Sitetracker \u{1F468}‍\u{1F4BB} go-live \u{1F680}",
    );
    expect(fix("\u{1F680}salsa\u{1F680}")).toBe("\u{1F680}SALSA\u{1F680}");
    const onlyEmoji = "\u{1F680}\u{1F680} ❤️";
    expect(fix(onlyEmoji)).toBe(onlyEmoji);
  });

  it("does not split a surrogate pair or choke on a lone surrogate", () => {
    const lone = "salsa \uD83D x \uDE00 site tracker";
    expect(fix(lone)).toBe("SALSA \uD83D x \uDE00 Sitetracker");
  });

  it("works with right-to-left text and terms in other scripts", () => {
    const hebrew = "שלום salsa עולם";
    expect(fix(hebrew)).toBe("שלום SALSA עולם");
    expect(correctWithVocabulary("שלום עולם", ["שלום"])).toBe("שלום עולם");
    expect(correctWithVocabulary("مرحبا salsa", ["مرحبا", "SALSA"])).toBe("مرحبا SALSA");
    expect(correctWithVocabulary("Привет мир", ["привет"])).toBe("привет мир");
  });

  it("treats control characters and NUL in the text as plain separators of nothing", () => {
    const text = "salsa\u0000site tracker\u0007go live";
    expect(fix(text)).toBe("SALSA\u0000Sitetracker\u0007go-live");
  });

  it("a one-word term made only of punctuation or emoji matches nothing", () => {
    const text = "--- ... \u{1F680} '' ";
    expect(correctWithVocabulary(text, ["---", "...", "\u{1F680}", "''"])).toBe(text);
  });

  it("is not tripped by hyphens and apostrophes that are not inside a word", () => {
    expect(fix("-salsa- 'salsa' salsa- -go live")).toBe("-SALSA- 'SALSA' SALSA- -go-live");
  });

  it("returns a text over the size limit unchanged instead of truncating it", () => {
    const text = "salsa ".repeat(Math.ceil((MAX_CORRECTION_TEXT_LENGTH + 1) / 6));
    expect(text.length).toBeGreaterThan(MAX_CORRECTION_TEXT_LENGTH);
    expect(fix(text)).toBe(text);
  });

  it("uses at most the first 200 terms", () => {
    const terms = Array.from({ length: MAX_VOCABULARY_TERMS }, (_, i) => `Term${String(i)}x`);
    terms.push("Salsa");
    expect(correctWithVocabulary("salsa term7x", terms)).toBe("salsa Term7x");
  });

  it("handles 200 terms over 200000 characters quickly", () => {
    const terms = Array.from({ length: MAX_VOCABULARY_TERMS }, (_, i) =>
      i % 3 === 0 ? `Word${String(i)} Pair` : `Word-${String(i)}x`,
    );
    const chunk = "site tracker go live word3 pair word4x salsa, ";
    const text = chunk.repeat(Math.floor(MAX_CORRECTION_TEXT_LENGTH / chunk.length));
    expect(text.length).toBeLessThanOrEqual(MAX_CORRECTION_TEXT_LENGTH);
    const started = performance.now();
    const out = correctWithVocabulary(text, [...terms.slice(0, 197), ...TERMS]);
    expect(performance.now() - started).toBeLessThan(2_000);
    expect(out.startsWith("Sitetracker go-live Word3 Pair Word-4x SALSA, ")).toBe(true);
  });

  it("handles one enormous word and a long run of separators quickly", () => {
    const started = performance.now();
    const word = "a".repeat(MAX_CORRECTION_TEXT_LENGTH);
    expect(fix(word)).toBe(word);
    const spaces = " ".repeat(MAX_CORRECTION_TEXT_LENGTH);
    expect(fix(spaces)).toBe(spaces);
    const hyphens = "a-".repeat(MAX_CORRECTION_TEXT_LENGTH / 2);
    expect(fix(hyphens)).toBe(hyphens);
    const pairs = "a b ".repeat(MAX_CORRECTION_TEXT_LENGTH / 4);
    expect(fix(pairs)).toBe(pairs);
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});

describe("correctWithVocabulary: idempotence", () => {
  it("is stable when a replacement changes how many words follow", () => {
    // 'go live' becomes the one word 'go-live', which then reads as the 3-word run 'go-live x y'.
    const terms = ["go-live", "golivexy"];
    const once = correctWithVocabulary("go live x y", terms);
    expect(correctWithVocabulary(once, terms)).toBe(once);
  });

  it("holds over generated texts and vocabularies", () => {
    let seed = 20_261_104;
    const next = (n: number): number => {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
      return seed % n;
    };
    const pieces = [
      "salsa",
      "Salsa",
      "site",
      "tracker",
      "Site-Tracker",
      "go",
      "live",
      "go-live",
      "x",
      "y",
      "a",
      "b",
      "ab",
      "abc",
      "Plan",
      "B",
      "planb",
      "amélie",
      "Amelie",
      "l’équipe",
      "l'equipe",
      ",",
      ".",
      "-",
      "'",
      "\n",
      "\t",
      "\u{1F680}",
      "ש",
      "C++",
      "(x)",
    ];
    const termPool = [
      "SALSA",
      "Sitetracker",
      "go-live",
      "Plan B",
      "ab",
      "a b",
      "a b c",
      "x y",
      "Live",
      "Go Live",
      "Amélie",
      "L'Équipe",
      "xy",
      "goLiveXy",
      "AB C",
      "tracker",
    ];
    for (let round = 0; round < 400; round += 1) {
      const terms = Array.from(
        { length: 1 + next(6) },
        () => termPool[next(termPool.length)] ?? "",
      );
      const parts: string[] = [];
      for (let i = 0, n = next(30); i < n; i += 1) {
        parts.push(pieces[next(pieces.length)] ?? "", next(4) === 0 ? "" : " ");
      }
      const text = parts.join("");
      const once = correctWithVocabulary(text, terms);
      expect(
        correctWithVocabulary(once, terms),
        `${JSON.stringify(text)} with ${JSON.stringify(terms)}`,
      ).toBe(once);
    }
  });

  it("returns text with no term variant unchanged, over generated texts", () => {
    let seed = 7;
    const next = (n: number): number => {
      seed = (Math.imul(seed, 1_103_515_245) + 12_345) >>> 0;
      return seed % n;
    };
    const pieces = ["hello", "world", "salsas", "x", ",", "\n", "\u{1F680}", "שלום", "naïve", " "];
    for (let round = 0; round < 200; round += 1) {
      const text = Array.from({ length: next(40) }, () => pieces[next(pieces.length)] ?? "").join(
        " ",
      );
      expect(fix(text)).toBe(text);
    }
  });
});

describe("boundedVocabulary", () => {
  it("trims, drops unusable terms and keeps the first 200 as given", () => {
    expect(boundedVocabulary(["  SALSA ", "", "  ", "a\nb", "Plan B"])).toEqual([
      "SALSA",
      "Plan B",
    ]);
    const many = Array.from({ length: 500 }, (_, i) => `T${String(i)}`);
    expect(boundedVocabulary(many)).toEqual(many.slice(0, MAX_VOCABULARY_TERMS));
    expect(boundedVocabulary(["x".repeat(MAX_VOCABULARY_TERM_LENGTH + 1), "ok"])).toEqual(["ok"]);
    expect(boundedVocabulary([])).toEqual([]);
  });
});

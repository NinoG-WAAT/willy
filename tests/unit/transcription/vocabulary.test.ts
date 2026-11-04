import { describe, expect, it } from "vitest";
import {
  MAX_TERMS_PER_OWNER,
  TERM_MAX_LENGTH,
  buildTranscriptionPrompt,
  canBeAutoCorrected,
  describeVocabularyStatus,
  normalizeTerm,
  parseTerms,
  planAddition,
  termKey,
} from "../../../src/domain/transcription/vocabulary";

describe("normalizeTerm", () => {
  it("trims, applies NFC and collapses whitespace", () => {
    expect(normalizeTerm("  Site   tracker \t")).toEqual({ ok: true, value: "Site tracker" });
    // "e" + combining acute becomes the single precomposed character.
    expect(normalizeTerm("Amélie")).toEqual({ ok: true, value: "Amélie" });
  });

  it("turns line breaks inside a term into single spaces", () => {
    expect(normalizeTerm("Project\r\nSALSA")).toEqual({ ok: true, value: "Project SALSA" });
  });

  it("accepts 1 to 80 characters and refuses the rest", () => {
    expect(normalizeTerm("x".repeat(TERM_MAX_LENGTH)).ok).toBe(true);
    expect(normalizeTerm("x".repeat(TERM_MAX_LENGTH + 1))).toEqual({
      ok: false,
      error: "too_long",
    });
    expect(normalizeTerm("")).toEqual({ ok: false, error: "empty" });
    expect(normalizeTerm("  \n ")).toEqual({ ok: false, error: "empty" });
    expect(normalizeTerm(42)).toEqual({ ok: false, error: "empty" });
  });

  it("counts the length after normalisation, not before", () => {
    expect(normalizeTerm(`${"x".repeat(80)}      `).ok).toBe(true);
  });

  it("refuses control characters other than whitespace", () => {
    for (const bad of ["a\u0000b", "a\u001bb", "a\u007fb", "a\u0085b"]) {
      expect(normalizeTerm(bad), JSON.stringify(bad)).toEqual({ ok: false, error: "control" });
    }
  });

  it("refuses a term that starts with a dash, after trimming", () => {
    expect(normalizeTerm("-model")).toEqual({ ok: false, error: "leading_dash" });
    expect(normalizeTerm("  --model x")).toEqual({ ok: false, error: "leading_dash" });
    expect(normalizeTerm("e-mail").ok).toBe(true);
  });
});

describe("termKey", () => {
  it("is case-insensitive and ignores Unicode composition", () => {
    expect(termKey("SALSA")).toBe(termKey("salsa"));
    expect(termKey("Élan")).toBe(termKey("élan"));
    expect(termKey("Sitetracker")).not.toBe(termKey("Site tracker"));
  });
});

describe("canBeAutoCorrected", () => {
  it("accepts words that are letters and digits once case, spaces, hyphens, apostrophes and accents are ignored", () => {
    for (const ok of [
      "SALSA",
      "Sitetracker",
      "Site tracker",
      "e-mail",
      "L'Oréal",
      "L’Oréal",
      "Projet 2026",
      "ZE-Ready",
      "Élan",
      "élan",
      "A1",
    ]) {
      expect(canBeAutoCorrected(ok), ok).toBe(true);
    }
  });

  it("refuses words with any other character: they still prime the recogniser", () => {
    for (const no of ["Node.js", "C++", "(x)", "R&D", "a/b", "50%", "C#", "foo_bar", "@home"]) {
      expect(canBeAutoCorrected(no), no).toBe(false);
    }
  });

  it("refuses a word with nothing left once the ignored characters are gone", () => {
    for (const no of ["-", "'", " - ", "́"]) expect(canBeAutoCorrected(no), no).toBe(false);
  });
});

describe("parseTerms", () => {
  it("splits on newlines and commas and ignores empty pieces", () => {
    expect(parseTerms("SALSA, Sitetracker\nAcme\r\n\n, ,Zed")).toEqual({
      ok: true,
      value: ["SALSA", "Sitetracker", "Acme", "Zed"],
    });
  });

  it("drops duplicates inside one submission, keeping the first spelling", () => {
    expect(parseTerms("Salsa, SALSA\nsalsa")).toEqual({ ok: true, value: ["Salsa"] });
  });

  it("asks for at least one word", () => {
    for (const empty of ["", "  ", ",,\n,"]) {
      expect(parseTerms(empty)).toEqual({
        ok: false,
        error: [{ field: "term", message: "Enter at least one word." }],
      });
    }
  });

  it("reports every invalid piece and adds none", () => {
    const result = parseTerms(`ok, --model x\n${"y".repeat(81)}`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toHaveLength(2);
    expect(result.error[0]?.message).toContain("cannot start with a dash");
    expect(result.error[1]?.message).toContain("at most 80 characters");
    for (const e of result.error) expect(e.field).toBe("term");
  });

  it("refuses a huge paste instead of truncating it", () => {
    expect(parseTerms("a, ".repeat(20_000)).ok).toBe(false);
  });

  it("refuses non-text input", () => {
    expect(parseTerms(undefined).ok).toBe(false);
  });
});

describe("planAddition", () => {
  it("lists the new terms and counts the ones already there, case-insensitively", () => {
    const plan = planAddition(["SALSA", "Acme"], "salsa, Zed\nacme, Yo");
    expect(plan).toEqual({ ok: true, value: { toAdd: ["Zed", "Yo"], alreadyThere: 2 } });
  });

  it("is a no-op when everything is already there", () => {
    expect(planAddition(["SALSA"], "SALSA")).toEqual({
      ok: true,
      value: { toAdd: [], alreadyThere: 1 },
    });
  });

  it("accepts exactly the limit and refuses one more, without truncating", () => {
    const existing = Array.from({ length: MAX_TERMS_PER_OWNER - 2 }, (_, i) => `term${String(i)}`);
    expect(planAddition(existing, "a1, a2").ok).toBe(true);
    const over = planAddition(existing, "a1, a2, a3");
    expect(over.ok).toBe(false);
    if (over.ok) return;
    expect(over.error[0]?.message).toContain(String(MAX_TERMS_PER_OWNER));
  });

  it("does not count duplicates of existing terms against the limit", () => {
    const existing = Array.from({ length: MAX_TERMS_PER_OWNER }, (_, i) => `term${String(i)}`);
    expect(planAddition(existing, "TERM0, term1")).toEqual({
      ok: true,
      value: { toAdd: [], alreadyThere: 2 },
    });
  });

  it("passes validation errors through", () => {
    expect(planAddition([], "-x").ok).toBe(false);
  });
});

describe("describeVocabularyStatus", () => {
  it("says how many terms the speech recogniser uses", () => {
    expect(describeVocabularyStatus(5, 5)).toBe("5 of 5 terms are used by the speech recogniser.");
    expect(describeVocabularyStatus(1, 1)).toBe("1 of 1 term is used by the speech recogniser.");
  });

  it("says how many do not fit", () => {
    expect(describeVocabularyStatus(60, 40)).toBe(
      "40 of 60 terms are used by the speech recogniser. 20 do not fit and are left out.",
    );
    expect(describeVocabularyStatus(3, 2)).toBe(
      "2 of 3 terms are used by the speech recogniser. 1 does not fit and is left out.",
    );
  });

  it("has nothing to say without terms", () => {
    expect(describeVocabularyStatus(0, 0)).toBe("");
  });
});

describe("buildTranscriptionPrompt", () => {
  it("is the plain list in list order", () => {
    expect(buildTranscriptionPrompt(["SALSA", "Sitetracker", "Acme"])).toEqual({
      text: "Termes : SALSA, Sitetracker, Acme.",
      used: ["SALSA", "Sitetracker", "Acme"],
      leftOut: [],
    });
  });

  it("has no prompt at all without terms", () => {
    expect(buildTranscriptionPrompt([])).toEqual({ text: "", used: [], leftOut: [] });
  });

  it("uses whole terms up to the budget and reports the rest in order", () => {
    const result = buildTranscriptionPrompt(["alpha", "bravo", "charlie", "delta"], 30);
    // "Termes : alpha, bravo, charlie." is 31 characters: one too many.
    expect(result.text).toBe("Termes : alpha, bravo.");
    expect(result.used).toEqual(["alpha", "bravo"]);
    expect(result.leftOut).toEqual(["charlie", "delta"]);
    expect(result.text.length).toBeLessThanOrEqual(30);
  });

  it("fits exactly at the budget", () => {
    const result = buildTranscriptionPrompt(["alpha", "bravo", "charlie"], 31);
    expect(result.text).toBe("Termes : alpha, bravo, charlie.");
    expect(result.leftOut).toEqual([]);
  });

  it("does not skip a long term to squeeze a later short one in", () => {
    const result = buildTranscriptionPrompt(["a", "x".repeat(40), "b"], 30);
    expect(result.used).toEqual(["a"]);
    expect(result.leftOut).toEqual(["x".repeat(40), "b"]);
  });

  it("defaults to 600 characters", () => {
    const terms = Array.from({ length: 200 }, (_, i) => `Project${String(i).padStart(3, "0")}`);
    const result = buildTranscriptionPrompt(terms);
    expect(result.text.length).toBeLessThanOrEqual(600);
    expect(result.used.length + result.leftOut.length).toBe(200);
    expect(result.leftOut.length).toBeGreaterThan(0);
    expect(result.text.startsWith("Termes : ")).toBe(true);
  });

  it("leaves everything out when not even one term fits", () => {
    expect(buildTranscriptionPrompt(["x".repeat(50)], 20)).toEqual({
      text: "",
      used: [],
      leftOut: ["x".repeat(50)],
    });
  });

  it("always starts with the fixed prefix, whatever the terms look like", () => {
    const result = buildTranscriptionPrompt(["--model x", "$(id)"]);
    expect(result.text).toBe("Termes : --model x, $(id).");
  });
});

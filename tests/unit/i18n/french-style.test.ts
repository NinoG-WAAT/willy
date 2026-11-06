import { describe, expect, it } from "vitest";
import { fr } from "../../../src/i18n/fr";

/**
 * The house style of the French catalog (docs/I18N.md section 13), read mechanically so a new
 * string cannot drift: the typographic apostrophe, a no-break space before ":", ";", "?" and "!"
 * and inside « », formal "vous", and the glossary words used the same way everywhere. The
 * checker is tested on broken inline samples first, so a checker that finds nothing cannot pass.
 */

const NBSP = " ";

/** A French word, bounded by letters rather than by \b (which does not know accents). */
const word = (pattern: string): RegExp =>
  new RegExp(`(?<![\\p{L}-])(?:${pattern})(?![\\p{L}-])`, "iu");

function styleProblems(text: string): string[] {
  const problems: string[] = [];
  if (text.includes("'")) problems.push("straight apostrophe (use ’)");
  if (text.includes('"')) problems.push("straight double quote (use « »)");
  if (text.includes("...")) problems.push("three dots (use …)");
  // A leading no-break space is allowed: ": {text}" joins a label to a name.
  if (/ {2,}|^ | $/.test(text)) problems.push("stray whitespace");
  // A mark that ends a word, followed by a space, a closing mark or the end, needs a no-break
  // space before it. "0:00", "https://" and "{x}:{y}" have no space after the colon and pass.
  for (const mark of [":", ";", "?", "!"]) {
    const escaped = mark === "?" ? "\\?" : mark;
    const bad = new RegExp(
      `[^\\u00a0\\s]${escaped}(?=\\s|$|\\u00bb)|(?<=[^\\u00a0]) ${escaped}`,
      "u",
    );
    if (bad.test(text)) problems.push(`no-break space missing before "${mark}"`);
  }
  if (new RegExp("\\u00ab(?!\\u00a0)|(?<!\\u00a0)\\u00bb", "u").test(text)) {
    problems.push("no-break space missing inside « »");
  }
  if (word("tu|toi|ton|ta|tes").test(text) || /(?<![\p{L}])t’/iu.test(text)) {
    problems.push('informal "tu" (use vous)');
  }
  return problems;
}

/** Words the glossary rules out, with the word to use instead. */
const FORBIDDEN_WORDS: [RegExp, string][] = [
  [/boîte de réception|boite de reception/iu, "Réception (Inbox)"],
  [/gabarit|template/iu, "modèle (Template)"],
  [word("invités?|invitées?"), "participant (Attendee)"],
  [word("orateurs?|locuteurs?"), "intervenant (Speaker)"],
  [word("se loguer|login"), "se connecter (Sign in)"],
  [word("courriels?|mails?"), "adresse e-mail (Email)"],
  [word("rendez-vous"), "réunion (Meeting)"],
  [word("verbatim|retranscriptions?"), "transcription (Transcript)"],
];

function glossaryProblems(text: string): string[] {
  return FORBIDDEN_WORDS.filter(([forbidden]) => forbidden.test(text)).map(
    ([, use]) => `use ${use}`,
  );
}

describe("the style checker finds what it should", () => {
  it("accepts good French", () => {
    expect(styleProblems(`Choisissez un dossier${NBSP}: l’un des vôtres${NBSP}!`)).toEqual([]);
    expect(styleProblems(`Un mot marqué «${NBSP}Exclu${NBSP}» ne part pas.`)).toEqual([]);
    expect(styleProblems("Durée 0:00, https://exemple.fr et {a}:{b}")).toEqual([]);
  });

  it("finds each kind of drift", () => {
    expect(styleProblems("Aujourd'hui")).toContain("straight apostrophe (use ’)");
    expect(styleProblems('Un "mot"')).toContain("straight double quote (use « »)");
    expect(styleProblems("Attendez...")).toContain("three dots (use …)");
    expect(styleProblems("Dossier : vide")).toContain('no-break space missing before ":"');
    expect(styleProblems("Dossier: vide")).toContain('no-break space missing before ":"');
    expect(styleProblems("Vraiment?")).toContain('no-break space missing before "?"');
    expect(styleProblems("Attention !")).toContain('no-break space missing before "!"');
    expect(styleProblems("Un « mot »")).toContain("no-break space missing inside « »");
    expect(styleProblems("Merci  beaucoup")).toContain("stray whitespace");
    expect(styleProblems("Choisis ton dossier")).toContain('informal "tu" (use vous)');
  });

  it("finds words the glossary rules out, and leaves the right ones alone", () => {
    expect(glossaryProblems("Votre boîte de réception")).toHaveLength(1);
    expect(glossaryProblems("Ajouter un invité")).toHaveLength(1);
    expect(glossaryProblems("Vos mails")).toHaveLength(1);
    expect(glossaryProblems("Votre adresse e-mail")).toEqual([]);
    expect(glossaryProblems("Note publiée par un participant")).toEqual([]);
  });
});

describe("the French catalog", () => {
  const entries = Object.entries(fr);
  const label = ([source, text]: [string, string], problem: string): string =>
    `${problem}: ${JSON.stringify(text.slice(0, 90))} (${source.slice(0, 50)})`;

  it("follows the typography and tone rules (docs/I18N.md section 13)", () => {
    const found = entries.flatMap((entry) =>
      styleProblems(entry[1]).map((problem) => label(entry, problem)),
    );
    expect(found).toEqual([]);
  });

  it("uses the glossary words and none of the ones it rules out", () => {
    const found = entries.flatMap((entry) =>
      glossaryProblems(entry[1]).map((problem) => label(entry, problem)),
    );
    expect(found).toEqual([]);
  });

  it("calls the Inbox Réception wherever it names it", () => {
    expect(fr["Inbox"]).toBe("Réception");
    expect(entries.filter(([, text]) => /réception/iu.test(text)).map(([, text]) => text)).toEqual([
      "Réception",
    ]);
  });
});

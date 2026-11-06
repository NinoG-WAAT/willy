import { describe, expect, it } from "vitest";
import {
  DEFAULT_TEMPLATE,
  TEMPLATE_LIMITS,
  builtinTemplate,
  normalizeTemplate,
} from "../../../src/domain/notes/template";
import { inLocale } from "../../support/locale";

const valid = {
  name: "  Weekly   sync ",
  isDefault: true,
  sections: [
    { heading: " Summary ", prompt: "Summarize\r\nthe discussion." },
    { heading: "Risks", prompt: "" },
  ],
};

function fieldsOf(result: ReturnType<typeof normalizeTemplate>): string[] {
  return result.ok ? [] : result.error.map((e) => e.field);
}

describe("normalizeTemplate", () => {
  it("normalizes name, headings and prompts", () => {
    expect(normalizeTemplate(valid)).toEqual({
      ok: true,
      value: {
        name: "Weekly sync",
        isDefault: true,
        sections: [
          { heading: "Summary", prompt: "Summarize\nthe discussion." },
          { heading: "Risks", prompt: "" },
        ],
      },
    });
  });

  it("ignores completely empty rows (unused blank form rows)", () => {
    const result = normalizeTemplate({
      ...valid,
      sections: [...valid.sections, { heading: " ", prompt: "" }, { heading: "", prompt: "  " }],
    });
    expect(result.ok && result.value.sections).toHaveLength(2);
  });

  it("requires a name and at least one section", () => {
    expect(fieldsOf(normalizeTemplate({ ...valid, name: " " }))).toContain("name");
    expect(fieldsOf(normalizeTemplate({ ...valid, sections: [] }))).toContain("sections");
    expect(
      fieldsOf(normalizeTemplate({ ...valid, sections: [{ heading: "", prompt: "" }] })),
    ).toContain("sections");
  });

  it("reports a prompt without a heading on that row", () => {
    const result = normalizeTemplate({ ...valid, sections: [{ heading: "", prompt: "orphan" }] });
    expect(fieldsOf(result)).toContain("sections.0.heading");
  });

  it("enforces length and count limits", () => {
    expect(
      fieldsOf(normalizeTemplate({ ...valid, name: "n".repeat(TEMPLATE_LIMITS.name + 1) })),
    ).toContain("name");
    expect(
      fieldsOf(
        normalizeTemplate({
          ...valid,
          sections: [{ heading: "h".repeat(TEMPLATE_LIMITS.heading + 1), prompt: "" }],
        }),
      ),
    ).toContain("sections.0.heading");
    expect(
      fieldsOf(
        normalizeTemplate({
          ...valid,
          sections: [{ heading: "ok", prompt: "p".repeat(TEMPLATE_LIMITS.prompt + 1) }],
        }),
      ),
    ).toContain("sections.0.prompt");
    const many = Array.from({ length: TEMPLATE_LIMITS.sections + 1 }, (_, i) => ({
      heading: `Section ${String(i)}`,
      prompt: "",
    }));
    expect(fieldsOf(normalizeTemplate({ ...valid, sections: many }))).toContain("sections");
  });

  it("rejects duplicate headings case-insensitively", () => {
    const result = normalizeTemplate({
      ...valid,
      sections: [
        { heading: "Summary", prompt: "" },
        { heading: "summary", prompt: "" },
      ],
    });
    expect(fieldsOf(result)).toContain("sections.1.heading");
  });

  it("collects every error so the form can show them all", () => {
    const result = normalizeTemplate({
      name: "",
      isDefault: false,
      sections: [{ heading: "", prompt: "x" }],
    });
    expect(fieldsOf(result)).toEqual(expect.arrayContaining(["name", "sections.0.heading"]));
  });

  it("keeps markup as plain text: it is escaped on output, never interpreted", () => {
    const result = normalizeTemplate({
      ...valid,
      sections: [{ heading: "<script>alert(1)</script>", prompt: "<img src=x onerror=1>" }],
    });
    expect(result.ok && result.value.sections[0]?.heading).toBe("<script>alert(1)</script>");
  });
});

describe("builtinTemplate: default layout per language (issue #122)", () => {
  it("is the English layout in English, unchanged", () => {
    const template = inLocale("en", () => builtinTemplate());
    expect(template.sections.map((s) => s.heading)).toEqual([
      "Summary",
      "Discussion",
      "Next steps",
    ]);
    expect(template).toEqual(DEFAULT_TEMPLATE);
  });

  it("is Résumé, Discussion, Prochaines étapes in French, with prompts in French", () => {
    const template = inLocale("fr", () => builtinTemplate());
    expect(template.sections.map((s) => s.heading)).toEqual([
      "Résumé",
      "Discussion",
      "Prochaines étapes",
    ]);
    expect(template.sections.map((s) => s.prompt)).toEqual([
      "Résumez ce qui a été discuté en quelques phrases.",
      "Listez les principaux sujets et ce qui a été dit sur chacun.",
      "Indiquez la suite prévue et les personnes concernées.",
    ]);
  });

  it("is a valid template in both languages, so the fallback can never break summaries", () => {
    for (const locale of ["en", "fr"] as const) {
      const template = inLocale(locale, () => builtinTemplate());
      expect(normalizeTemplate({ ...template, isDefault: false }).ok).toBe(true);
    }
  });

  it("follows the language in force at each call, never the one at import time", () => {
    expect(inLocale("fr", () => builtinTemplate()).sections[0]?.heading).toBe("Résumé");
    expect(inLocale("en", () => builtinTemplate()).sections[0]?.heading).toBe("Summary");
  });
});

describe("DEFAULT_TEMPLATE", () => {
  it("is itself a valid template, so the fallback can never break summaries", () => {
    expect(normalizeTemplate({ ...DEFAULT_TEMPLATE, isDefault: false }).ok).toBe(true);
  });
});

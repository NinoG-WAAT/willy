import { err, ok, type Result } from "../platform/result";
import { normalizeLine, normalizeMultiline, type FieldError } from "../platform/text";

export interface TemplateSection {
  heading: string;
  prompt: string;
}

export interface TemplateInput {
  name: string;
  isDefault: boolean;
  sections: TemplateSection[];
}

export const TEMPLATE_LIMITS = { name: 100, sections: 12, heading: 80, prompt: 500 } as const;

/** Used when an owner has no default template of their own. */
export const DEFAULT_TEMPLATE: Readonly<TemplateInput> = {
  name: "Default",
  isDefault: true,
  sections: [
    { heading: "Summary", prompt: "Summarize what was discussed in a few sentences." },
    { heading: "Discussion", prompt: "List the main topics and what was said about each." },
    { heading: "Next steps", prompt: "Note what happens next and who is involved." },
  ],
};

interface RawTemplate {
  name: unknown;
  isDefault: boolean;
  sections: readonly { heading: unknown; prompt: unknown }[];
}

/**
 * Validates and normalizes template input. Blank rows (no heading, no prompt) are the unused rows
 * of the form and are dropped. All problems are returned together so the form can show them at once.
 * Text is stored as plain text; it is escaped on output and never interpreted as markup.
 */
export function normalizeTemplate(raw: RawTemplate): Result<TemplateInput, FieldError[]> {
  const errors: FieldError[] = [];

  const name = normalizeLine(raw.name) ?? "";
  if (name === "") errors.push({ field: "name", message: "Enter a template name." });
  else if (name.length > TEMPLATE_LIMITS.name) {
    errors.push({
      field: "name",
      message: `Template names can be at most ${String(TEMPLATE_LIMITS.name)} characters.`,
    });
  }

  const sections: TemplateSection[] = [];
  const seen = new Set<string>();
  raw.sections.forEach((row, index) => {
    const heading = normalizeLine(row.heading) ?? "";
    const prompt = normalizeMultiline(row.prompt) ?? "";
    if (heading === "" && prompt === "") return;
    const at = (part: string) => `sections.${String(index)}.${part}`;
    if (heading === "") {
      errors.push({ field: at("heading"), message: "Give this section a heading." });
    } else if (heading.length > TEMPLATE_LIMITS.heading) {
      errors.push({
        field: at("heading"),
        message: `Headings can be at most ${String(TEMPLATE_LIMITS.heading)} characters.`,
      });
    } else if (seen.has(heading.toLowerCase())) {
      errors.push({ field: at("heading"), message: "Each section needs a different heading." });
    }
    seen.add(heading.toLowerCase());
    if (prompt.length > TEMPLATE_LIMITS.prompt) {
      errors.push({
        field: at("prompt"),
        message: `Prompts can be at most ${String(TEMPLATE_LIMITS.prompt)} characters.`,
      });
    }
    sections.push({ heading, prompt });
  });

  if (sections.length === 0 && !errors.some((e) => e.field.startsWith("sections."))) {
    errors.push({ field: "sections", message: "Add at least one section." });
  }
  if (sections.length > TEMPLATE_LIMITS.sections) {
    errors.push({
      field: "sections",
      message: `A template can have at most ${String(TEMPLATE_LIMITS.sections)} sections.`,
    });
  }

  return errors.length > 0 ? err(errors) : ok({ name, isDefault: raw.isDefault, sections });
}

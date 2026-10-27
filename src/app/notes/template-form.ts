import { err, ok, type Result } from "../../domain/platform/result";
import { readFormFields, single } from "../platform/form";

export interface RawTemplateForm {
  name: string;
  isDefault: boolean;
  sections: { heading: string; prompt: string }[];
}

/** Fields the template editor may send; `intent` and `csrf_token` belong to the page and middleware. */
const TEMPLATE_FIELDS = [
  "csrf_token",
  "intent",
  "name",
  "is_default",
  "section_heading",
  "section_prompt",
] as const;

/** Turns the editor's repeated `section_heading` / `section_prompt` fields into rows by position. */
export function parseTemplateForm(form: FormData): Result<RawTemplateForm, "malformed"> {
  const fields = readFormFields(form, TEMPLATE_FIELDS);
  if (!fields) return err("malformed");
  const headings = fields.get("section_heading") ?? [];
  const prompts = fields.get("section_prompt") ?? [];
  if (headings.length !== prompts.length) return err("malformed");
  return ok({
    name: single(fields, "name") ?? "",
    isDefault: single(fields, "is_default") === "on",
    sections: headings.map((heading, i) => ({ heading, prompt: prompts[i] ?? "" })),
  });
}

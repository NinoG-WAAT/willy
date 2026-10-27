import { describe, expect, it } from "vitest";
import { parseTemplateForm } from "../../../src/app/notes/template-form";

function form(entries: [string, string | Blob][]): FormData {
  const data = new FormData();
  for (const [k, v] of entries) data.append(k, v);
  return data;
}

describe("parseTemplateForm", () => {
  it("pairs repeated heading and prompt fields by position", () => {
    const parsed = parseTemplateForm(
      form([
        ["csrf_token", "t"],
        ["name", "Weekly"],
        ["is_default", "on"],
        ["section_heading", "Summary"],
        ["section_prompt", "Summarize"],
        ["section_heading", "Risks"],
        ["section_prompt", ""],
      ]),
    );
    expect(parsed).toEqual({
      ok: true,
      value: {
        name: "Weekly",
        isDefault: true,
        sections: [
          { heading: "Summary", prompt: "Summarize" },
          { heading: "Risks", prompt: "" },
        ],
      },
    });
  });

  it("treats a missing checkbox as not default", () => {
    const parsed = parseTemplateForm(form([["name", "x"]]));
    expect(parsed.ok && parsed.value.isDefault).toBe(false);
  });

  it("rejects unknown fields, file uploads and mismatched section columns", () => {
    expect(parseTemplateForm(form([["owner_id", "other"]])).ok).toBe(false);
    expect(parseTemplateForm(form([["name", new Blob(["x"])]])).ok).toBe(false);
    expect(
      parseTemplateForm(
        form([
          ["section_heading", "a"],
          ["section_heading", "b"],
          ["section_prompt", "x"],
        ]),
      ).ok,
    ).toBe(false);
  });
});

import {
  DEFAULT_TEMPLATE,
  normalizeTemplate,
  type TemplateInput,
  type TemplateSection,
} from "../../domain/notes/template";
import { err, ok, type Result } from "../../domain/platform/result";
import type { Template, TemplateWithUsage } from "../../ports/template-repository";
import type { NotesDeps } from "./deps";
import { NOT_FOUND, nameTaken, type NotesError } from "./errors";

type RawTemplate = Parameters<typeof normalizeTemplate>[0];

export function listTemplates(deps: NotesDeps, ownerId: string): Promise<TemplateWithUsage[]> {
  return deps.templates.list(ownerId);
}

export async function findTemplate(
  deps: NotesDeps,
  ownerId: string,
  id: string,
): Promise<Result<TemplateWithUsage, NotesError>> {
  const template = await deps.templates.find(ownerId, id);
  return template ? ok(template) : err(NOT_FOUND);
}

function validate(raw: RawTemplate): Result<TemplateInput, NotesError> {
  const normalized = normalizeTemplate(raw);
  return normalized.ok ? normalized : err({ kind: "invalid", errors: normalized.error });
}

export async function createTemplate(
  deps: NotesDeps,
  ownerId: string,
  raw: RawTemplate,
): Promise<Result<Template, NotesError>> {
  const input = validate(raw);
  if (!input.ok) return input;
  const now = deps.clock.now().toISOString();
  const template: Template = {
    id: deps.ids.newId(),
    ...input.value,
    createdAt: now,
    updatedAt: now,
  };
  const created = await deps.templates.create(ownerId, template);
  return created.ok ? ok(template) : err(nameTaken("template"));
}

export async function updateTemplate(
  deps: NotesDeps,
  ownerId: string,
  id: string,
  raw: RawTemplate,
): Promise<Result<void, NotesError>> {
  const input = validate(raw);
  if (!input.ok) return input;
  const existing = await deps.templates.find(ownerId, id);
  if (!existing) return err(NOT_FOUND);
  const updated = await deps.templates.update(ownerId, {
    ...existing,
    ...input.value,
    updatedAt: deps.clock.now().toISOString(),
  });
  if (updated.ok) return ok(undefined);
  return err(updated.error === "not_found" ? NOT_FOUND : nameTaken("template"));
}

export async function setDefaultTemplate(
  deps: NotesDeps,
  ownerId: string,
  id: string,
): Promise<Result<void, NotesError>> {
  const done = await deps.templates.setDefault(ownerId, id, deps.clock.now().toISOString());
  return done.ok ? ok(undefined) : err(NOT_FOUND);
}

export async function deleteTemplate(
  deps: NotesDeps,
  ownerId: string,
  id: string,
): Promise<Result<{ detachedMeetings: number }, NotesError>> {
  const deleted = await deps.templates.delete(ownerId, id);
  return deleted.ok ? deleted : err(NOT_FOUND);
}

export interface ResolvedTemplate {
  /** `chosen`: picked explicitly; `default`: the owner's default; `builtin`: the fallback. */
  source: "chosen" | "default" | "builtin";
  id: string | null;
  name: string;
  sections: TemplateSection[];
}

/**
 * Picks the template for a new meeting (used by the new-note flow and by summary generation).
 * An explicit id must belong to the owner; otherwise the owner's default, then the built-in one.
 */
export async function resolveTemplateForNewMeeting(
  deps: NotesDeps,
  ownerId: string,
  templateId: string | null,
): Promise<Result<ResolvedTemplate, NotesError>> {
  if (templateId !== null) {
    const chosen = await deps.templates.find(ownerId, templateId);
    if (!chosen) return err(NOT_FOUND);
    return ok({ source: "chosen", id: chosen.id, name: chosen.name, sections: chosen.sections });
  }
  const owners = await deps.templates.findDefault(ownerId);
  if (owners) {
    return ok({ source: "default", id: owners.id, name: owners.name, sections: owners.sections });
  }
  return ok({
    source: "builtin",
    id: null,
    name: DEFAULT_TEMPLATE.name,
    sections: [...DEFAULT_TEMPLATE.sections],
  });
}

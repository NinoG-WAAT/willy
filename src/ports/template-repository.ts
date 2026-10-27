import type { Result } from "../domain/platform/result";
import type { TemplateSection } from "../domain/notes/template";

export interface Template {
  id: string;
  name: string;
  sections: TemplateSection[];
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateWithUsage extends Template {
  /** Meetings that were created from this template. */
  meetingCount: number;
}

/** Every method is scoped by `ownerId`; another owner's template behaves exactly like a missing one. */
export interface TemplateRepository {
  list(ownerId: string): Promise<TemplateWithUsage[]>;
  find(ownerId: string, id: string): Promise<TemplateWithUsage | null>;
  findDefault(ownerId: string): Promise<Template | null>;
  /** When `template.isDefault`, the previous default is demoted in the same transaction. */
  create(ownerId: string, template: Template): Promise<Result<void, "name_taken">>;
  update(ownerId: string, template: Template): Promise<Result<void, "not_found" | "name_taken">>;
  setDefault(ownerId: string, id: string, updatedAt: string): Promise<Result<void, "not_found">>;
  /** Detaches the owner's meetings from the template in the same transaction, then deletes it. */
  delete(ownerId: string, id: string): Promise<Result<{ detachedMeetings: number }, "not_found">>;
}

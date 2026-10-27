import type { Clock } from "../../ports/clock";
import type { FolderRepository } from "../../ports/folder-repository";
import type { IdGenerator } from "../../ports/id-generator";
import type { TemplateRepository } from "../../ports/template-repository";

export interface NotesDeps {
  folders: FolderRepository;
  templates: TemplateRepository;
  clock: Clock;
  ids: IdGenerator;
}

import { normalizeNewMeeting, type RawNewMeeting } from "../../domain/meetings/new-meeting";
import { err, ok, type Result } from "../../domain/platform/result";
import type { MeetingCreation } from "../../ports/meeting-creation";
import type { NotesDeps } from "../notes/deps";
import type { NotesError } from "../notes/errors";
import { resolveTemplateForNewMeeting } from "../notes/templates";

export interface CreateMeetingDeps {
  creation: MeetingCreation;
  notes: NotesDeps;
}

export type CreateMeetingInput = RawNewMeeting & {
  /** Empty string means "use my default template". */
  templateId: string;
  /** Hidden form token that makes a double submit create one meeting. */
  submissionId: string;
};

const SUBMISSION_ID = /^[A-Za-z0-9-]{8,100}$/;

/** The new-note form: validate, apply the template, create once per submission token. */
export async function createMeeting(
  deps: CreateMeetingDeps,
  ownerId: string,
  raw: CreateMeetingInput,
): Promise<Result<{ meetingId: string; created: boolean }, NotesError>> {
  if (!SUBMISSION_ID.test(raw.submissionId)) {
    return err({
      kind: "invalid",
      errors: [
        { field: "submission_id", message: "This form expired. Reload the page and try again." },
      ],
    });
  }
  const input = normalizeNewMeeting(raw);
  if (!input.ok) return err({ kind: "invalid", errors: input.error });

  const template = await resolveTemplateForNewMeeting(
    deps.notes,
    ownerId,
    raw.templateId === "" ? null : raw.templateId,
  );
  if (!template.ok) {
    return err({
      kind: "invalid",
      errors: [{ field: "template_id", message: "Choose one of your own templates." }],
    });
  }

  const created = await deps.creation.create(
    ownerId,
    { ...input.value, templateId: template.value.id },
    raw.submissionId,
  );
  return ok(created);
}

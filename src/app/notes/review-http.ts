import { t } from "../../i18n/translate";
import type { FieldError } from "../../domain/platform/text";
import type { Result } from "../../domain/platform/result";
import { isValidStorageId } from "../../domain/storage/object-key";
import { retryMeetingProcessing, type MeetingDeps } from "../meetings/capture";
import { readFormFields, single } from "../platform/form";
import { moveNoteToFolder, type MoveNoteError, type MoveNoteOutcome } from "./move-note";
import {
  addActionItem,
  assignSpeakerToLines,
  addDecision,
  deleteActionItem,
  deleteDecision,
  editActionItem,
  editDecision,
  editSection,
  publishNote,
  renameSpeaker,
  reopenNote,
  setActionItemDone,
  type ReviewDeps,
  type ReviewError,
} from "./review";

export interface ReviewFormDeps {
  review: ReviewDeps;
  capture: MeetingDeps;
}

export type ReviewFormResult =
  | { kind: "redirect"; notice: string; anchor: string | null }
  | { kind: "not_found" }
  | { kind: "bad_request" }
  | {
      kind: "problem";
      status: 409 | 422;
      message: string;
      errors: FieldError[];
      /** What the owner typed into the failing form, so nothing is lost on a 422. */
      echo: { itemId: string | null; values: Record<string, string>; lines: string[] };
    };

/**
 * Fixed codes only: nothing from the URL is ever reflected into the page. The two move notices
 * name the folder the note is in now, which the page reads from the database (never the URL).
 * A switch with one literal `t()` per code, so the strings are found by the catalog scanner and
 * nothing is translated when this module loads.
 */
export function reviewNoticeText(
  code: string | null,
  folderName: string | null = null,
): string | null {
  switch (code) {
    case "moved":
      return folderName === null ? t("Moved.") : t("Moved to {folder}.", { folder: folderName });
    case "move_unchanged":
      return folderName === null
        ? t("Already in that folder.")
        : t("Already in {folder}.", { folder: folderName });
    case "section_saved":
      return t("Section saved.");
    case "decision_saved":
      return t("Decision saved.");
    case "decision_added":
      return t("Decision added.");
    case "decision_removed":
      return t("Decision removed from the draft.");
    case "action_saved":
      return t("Action item saved.");
    case "action_added":
      return t("Action item added.");
    case "action_removed":
      return t("Action item removed from the draft.");
    case "action_done":
      return t("Action item marked as done.");
    case "action_reopened":
      return t("Action item reopened.");
    case "speaker_renamed":
      return t("Speaker renamed on every line of the transcript.");
    case "speakers_merged":
      return t("Speakers merged on every line of the transcript.");
    case "speaker_assigned":
      return t("Lines assigned to the speaker.");
    case "published":
      return t("Published. This note is no longer a draft.");
    case "reopened":
      return t("Reopened. The note is a draft again and can be edited.");
    case "retry_queued":
      return t("Transcription restarted. Only the parts that failed are redone.");
    case "draft_regeneration_queued":
      return t(
        "Regenerating the whole draft. It will update here when it is ready; " +
          "your current draft stays until then.",
      );
    default:
      return null;
  }
}

const FIELDS = [
  "csrf_token",
  "intent",
  "id",
  "body",
  "text",
  "assignee",
  "due",
  "done",
  "from",
  "to",
  "line",
  "folder",
  "confirm",
] as const;
const NOT_ECHOED = new Set(["csrf_token", "intent", "id"]);

type Done = { notice: string; anchor: string | null };

/**
 * Applies one review-screen form post. The owner comes from the session, the meeting from the
 * path; unknown fields, repeated fields, unknown intents and malformed ids are a bad request.
 * Expected failures become a `problem` the page shows (422 field errors, 409 wrong state), other
 * owners' and unknown ids a `not_found`. Session and CSRF are enforced earlier, by the middleware.
 */
export async function handleReviewForm(
  deps: ReviewFormDeps,
  ownerId: string,
  meetingId: string,
  form: FormData,
): Promise<ReviewFormResult> {
  const fields = readFormFields(form, FIELDS);
  // Every field is single-valued, except the ticked transcript lines of one intent.
  if (!fields || [...fields].some(([name, v]) => name !== "line" && v.length !== 1)) {
    return { kind: "bad_request" };
  }
  const intent = single(fields, "intent");
  if (fields.has("line") && intent !== "assign_speaker") return { kind: "bad_request" };
  const id = single(fields, "id") ?? "";
  if (id !== "" && !isValidStorageId(id)) return { kind: "bad_request" };
  const value = (name: string): string => single(fields, name) ?? "";
  const item = {
    text: value("text"),
    assignee: value("assignee"),
    due: value("due"),
    done: value("done") === "on",
  };
  const r = deps.review;

  const finish = (result: Result<void, ReviewError>, done: Done): ReviewFormResult => {
    if (result.ok) return { kind: "redirect", ...done };
    return problemOrNotFound(result.error, id === "" ? (intent ?? null) : id, fields);
  };

  switch (intent) {
    case "edit_section":
      return finish(await editSection(r, ownerId, meetingId, id, value("body")), {
        notice: "section_saved",
        anchor: `section-${id}`,
      });
    case "add_decision":
      return finish(await addDecision(r, ownerId, meetingId, value("text")), {
        notice: "decision_added",
        anchor: "decisions",
      });
    case "edit_decision":
      return finish(await editDecision(r, ownerId, meetingId, id, value("text")), {
        notice: "decision_saved",
        anchor: `decision-${id}`,
      });
    case "delete_decision":
      return finish(await deleteDecision(r, ownerId, meetingId, id), {
        notice: "decision_removed",
        anchor: "decisions",
      });
    case "add_action_item":
      return finish(await addActionItem(r, ownerId, meetingId, item), {
        notice: "action_added",
        anchor: "action-items",
      });
    case "edit_action_item":
      return finish(await editActionItem(r, ownerId, meetingId, id, item), {
        notice: "action_saved",
        anchor: `action-${id}`,
      });
    case "delete_action_item":
      return finish(await deleteActionItem(r, ownerId, meetingId, id), {
        notice: "action_removed",
        anchor: "action-items",
      });
    case "set_action_item_done": {
      // An unticked checkbox sends no field: absent means open, so the request is idempotent.
      const done = item.done;
      return finish(await setActionItemDone(r, ownerId, meetingId, id, done), {
        notice: done ? "action_done" : "action_reopened",
        anchor: `action-${id}`,
      });
    }
    case "rename_speaker":
    case "merge_speaker":
      return finish(await renameSpeaker(r, ownerId, meetingId, value("from"), value("to")), {
        notice: intent === "rename_speaker" ? "speaker_renamed" : "speakers_merged",
        anchor: "speakers",
      });
    case "assign_speaker":
      return finish(
        await assignSpeakerToLines(r, ownerId, meetingId, fields.get("line") ?? [], value("to")),
        { notice: "speaker_assigned", anchor: "transcript-panel" },
      );
    case "publish":
      return finish(
        await publishNote(r, ownerId, meetingId, {
          folderId: value("folder"),
          confirmed: value("confirm") === "on",
        }),
        { notice: "published", anchor: "publish" },
      );
    case "reopen":
      return finish(await reopenNote(r, ownerId, meetingId), {
        notice: "reopened",
        anchor: "publish",
      });
    case "move_note":
      return moveResult(await moveNoteToFolder(r, ownerId, meetingId, value("folder")), fields);
    case "retry_transcription": {
      const retried = await retryMeetingProcessing(deps.capture, ownerId, meetingId);
      if (retried.ok) return { kind: "redirect", notice: "retry_queued", anchor: null };
      if (retried.error.kind === "not_found") return { kind: "not_found" };
      // A second click finds the retry already under way: that is the outcome the owner wanted.
      if (retried.error.kind === "invalid_transition" && retried.error.from === "processing") {
        return { kind: "redirect", notice: "retry_queued", anchor: null };
      }
      return conflict(t("Transcription can only be retried after it failed."), fields);
    }
    default:
      return { kind: "bad_request" };
  }
}

/** Where the owner lands after a move: the control in the header, next to the folder chip. */
const MOVE_ANCHOR = "move-folder";

function moveResult(
  result: Result<MoveNoteOutcome, MoveNoteError>,
  fields: Map<string, string[]>,
): ReviewFormResult {
  if (result.ok) {
    return {
      kind: "redirect",
      notice: result.value.moved ? "moved" : "move_unchanged",
      anchor: MOVE_ANCHOR,
    };
  }
  switch (result.error.kind) {
    case "not_found":
      return { kind: "not_found" };
    case "folder_not_found":
      return problemOrNotFound(
        {
          kind: "invalid",
          errors: [
            {
              field: "folder",
              message: t("That folder is not available. Choose one of your folders."),
            },
          ],
        },
        "move_note",
        fields,
      );
    case "not_published":
      return conflict(
        t(
          "Only a published note can be moved to another folder. " +
            "This one is not published right now; the page shows where things stand.",
        ),
        fields,
      );
    case "conflict":
      return conflict(
        t("The note changed at the same moment. Check it below and try again."),
        fields,
      );
  }
}

function conflict(message: string, fields: Map<string, string[]>): ReviewFormResult {
  return { kind: "problem", status: 409, message, errors: [], echo: echoOf(null, fields) };
}

function echoOf(itemId: string | null, fields: Map<string, string[]>) {
  const values: Record<string, string> = {};
  for (const [name, list] of fields) if (!NOT_ECHOED.has(name)) values[name] = list[0] ?? "";
  // The ticked transcript lines (assign_speaker only), so a rejected form can tick them again.
  return { itemId, values, lines: fields.get("line") ?? [] };
}

function problemOrNotFound(
  error: ReviewError,
  itemId: string | null,
  fields: Map<string, string[]>,
): ReviewFormResult {
  switch (error.kind) {
    case "not_found":
      return { kind: "not_found" };
    case "invalid":
      return {
        kind: "problem",
        status: 422,
        message: t("That was not saved. Fix the highlighted problem and try again."),
        errors: error.errors,
        echo: echoOf(itemId, fields),
      };
    case "not_editable":
      return conflict(
        t(
          "This note is not an editable draft right now. Reopen it if it is published; " +
            "the page shows where things stand.",
        ),
        fields,
      );
    case "conflict":
      return conflict(
        t("The note changed at the same moment. Check it below and try again."),
        fields,
      );
  }
}

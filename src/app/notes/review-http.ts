import type { FieldError } from "../../domain/platform/text";
import type { Result } from "../../domain/platform/result";
import { isValidStorageId } from "../../domain/storage/object-key";
import { retryMeetingProcessing, type MeetingDeps } from "../meetings/capture";
import { readFormFields, single } from "../platform/form";
import {
  addActionItem,
  addDecision,
  deleteActionItem,
  deleteDecision,
  editActionItem,
  editDecision,
  editSection,
  publishNote,
  renameSpeaker,
  reopenNote,
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
      echo: { itemId: string | null; values: Record<string, string> };
    };

const NOTICES: Readonly<Record<string, string>> = {
  section_saved: "Section saved.",
  decision_saved: "Decision saved.",
  decision_added: "Decision added.",
  decision_removed: "Decision removed from the draft.",
  action_saved: "Action item saved.",
  action_added: "Action item added.",
  action_removed: "Action item removed from the draft.",
  speaker_renamed: "Speaker renamed on every line of the transcript.",
  speakers_merged: "Speakers merged on every line of the transcript.",
  published: "Published. This note is no longer a draft.",
  reopened: "Reopened. The note is a draft again and can be edited.",
  retry_queued: "Transcription restarted. Only the parts that failed are redone.",
};

/** Fixed codes only: nothing from the URL is ever reflected into the page. */
export function reviewNoticeText(code: string | null): string | null {
  return code !== null && Object.hasOwn(NOTICES, code) ? (NOTICES[code] ?? null) : null;
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
  if (!fields || [...fields.values()].some((v) => v.length !== 1)) return { kind: "bad_request" };
  const intent = single(fields, "intent");
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
    case "rename_speaker":
    case "merge_speaker":
      return finish(await renameSpeaker(r, ownerId, meetingId, value("from"), value("to")), {
        notice: intent === "rename_speaker" ? "speaker_renamed" : "speakers_merged",
        anchor: "speakers",
      });
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
    case "retry_transcription": {
      const retried = await retryMeetingProcessing(deps.capture, ownerId, meetingId);
      if (retried.ok) return { kind: "redirect", notice: "retry_queued", anchor: null };
      if (retried.error.kind === "not_found") return { kind: "not_found" };
      // A second click finds the retry already under way: that is the outcome the owner wanted.
      if (retried.error.kind === "invalid_transition" && retried.error.from === "processing") {
        return { kind: "redirect", notice: "retry_queued", anchor: null };
      }
      return conflict("Transcription can only be retried after it failed.", fields);
    }
    default:
      return { kind: "bad_request" };
  }
}

function conflict(message: string, fields: Map<string, string[]>): ReviewFormResult {
  return { kind: "problem", status: 409, message, errors: [], echo: echoOf(null, fields) };
}

function echoOf(itemId: string | null, fields: Map<string, string[]>) {
  const values: Record<string, string> = {};
  for (const [name, list] of fields) if (!NOT_ECHOED.has(name)) values[name] = list[0] ?? "";
  return { itemId, values };
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
        message: "That was not saved. Fix the highlighted problem and try again.",
        errors: error.errors,
        echo: echoOf(itemId, fields),
      };
    case "not_editable":
      return conflict(
        "This note is not an editable draft right now. Reopen it if it is published; the page shows where things stand.",
        fields,
      );
    case "conflict":
      return conflict("The note changed at the same moment. Check it below and try again.", fields);
  }
}

import { canEditMeeting, canViewMeeting } from "../../domain/authz/predicates";
import {
  publishMeeting,
  reopenMeeting,
  type Meeting,
  type MeetingStatus,
  type TransitionOutcome,
} from "../../domain/meetings/lifecycle";
import {
  normalizeActionItemInput,
  normalizeDecisionText,
  normalizeSectionBody,
  normalizeSpeakerName,
} from "../../domain/notes/review";
import { err, ok, type Result } from "../../domain/platform/result";
import type { FieldError } from "../../domain/platform/text";
import { segmentTextContext } from "../../domain/transcription/encryption-context";
import type { Clock } from "../../ports/clock";
import type { Folder, FolderRepository } from "../../ports/folder-repository";
import type { MeetingRepository } from "../../ports/meeting-repository";
import type { ReviewRepository, ReviewView } from "../../ports/review-repository";
import type { TextCipher } from "../../ports/text-cipher";

export interface ReviewDeps {
  reviews: ReviewRepository;
  folders: FolderRepository;
  meetings: MeetingRepository;
  textCipher: TextCipher;
  clock: Clock;
}

/**
 * `not_found` also covers other owners' ids and meetings being deleted (a 404, never a 403).
 * `not_editable`: the note is not a draft in review (a published note is reopened first).
 */
export type ReviewError =
  | { kind: "not_found" }
  | { kind: "not_editable"; status: MeetingStatus }
  | { kind: "invalid"; errors: FieldError[] }
  | { kind: "conflict" };

export interface ReviewSegmentText {
  id: string;
  position: number;
  startMs: number;
  speaker: string;
  /** Null when this one segment cannot be decrypted: the rest of the page still works. */
  text: string | null;
}

export interface ReviewPage {
  view: ReviewView;
  segments: ReviewSegmentText[];
  folders: Folder[];
  /** True only for a draft note in review: everything else is shown read-only. */
  editable: boolean;
}

/** Statuses before there is anything to review: the live note screen handles them. */
const NOT_READY: readonly MeetingStatus[] = ["scheduled", "capturing", "paused"];

export async function loadReviewPage(
  deps: ReviewDeps,
  ownerId: string,
  meetingId: string,
): Promise<Result<ReviewPage, { kind: "not_found" } | { kind: "not_ready" }>> {
  const view = await deps.reviews.loadReview(ownerId, meetingId);
  if (!view || !canViewMeeting(ownerId, { ownerId, status: view.meeting.status })) {
    return err({ kind: "not_found" });
  }
  if (NOT_READY.includes(view.meeting.status)) return err({ kind: "not_ready" });

  const segments = await Promise.all(
    view.segments.map(async (s): Promise<ReviewSegmentText> => {
      const base = { id: s.id, position: s.position, startMs: s.startMs, speaker: s.speaker };
      try {
        return {
          ...base,
          text: await deps.textCipher.decrypt(s.textCiphertext, segmentTextContext(s.id)),
        };
      } catch {
        return { ...base, text: null };
      }
    }),
  );
  return ok({
    view,
    segments,
    folders: await deps.folders.list(ownerId),
    editable: view.meeting.status === "review" && view.note?.status === "draft",
  });
}

/** Loads the owner's meeting and checks it is a draft in review: the gate of every edit. */
async function editableMeeting(
  deps: ReviewDeps,
  ownerId: string,
  meetingId: string,
): Promise<Result<Meeting, ReviewError>> {
  const meeting = await deps.meetings.findById(ownerId, meetingId);
  if (!meeting || !canEditMeeting(ownerId, meeting)) return err({ kind: "not_found" });
  if (meeting.status !== "review") return err({ kind: "not_editable", status: meeting.status });
  return ok(meeting);
}

const invalid = (field: string, message: string): ReviewError => ({
  kind: "invalid",
  errors: [{ field, message }],
});

/** Another owner's or unknown item, or a note that stopped being a draft meanwhile. */
const MISSING: ReviewError = { kind: "not_found" };

type Outcome = "saved" | "missing" | "unknown_assignee";

function toResult(outcome: Outcome): Result<void, ReviewError> {
  if (outcome === "saved") return ok(undefined);
  if (outcome === "unknown_assignee") {
    return err(invalid("assignee", "Choose one of this meeting's attendees."));
  }
  return err(MISSING);
}

export async function editSection(
  deps: ReviewDeps,
  ownerId: string,
  meetingId: string,
  sectionId: string,
  rawBody: unknown,
): Promise<Result<void, ReviewError>> {
  const gate = await editableMeeting(deps, ownerId, meetingId);
  if (!gate.ok) return gate;
  const body = normalizeSectionBody(rawBody);
  if (!body.ok) return err({ kind: "invalid", errors: [body.error] });
  return toResult(
    await deps.reviews.editSection(ownerId, meetingId, sectionId, body.value, deps.clock.now()),
  );
}

export async function addDecision(
  deps: ReviewDeps,
  ownerId: string,
  meetingId: string,
  rawText: unknown,
): Promise<Result<void, ReviewError>> {
  const gate = await editableMeeting(deps, ownerId, meetingId);
  if (!gate.ok) return gate;
  const text = normalizeDecisionText(rawText);
  if (!text.ok) return err({ kind: "invalid", errors: [text.error] });
  return toResult(await deps.reviews.addDecision(ownerId, meetingId, text.value, deps.clock.now()));
}

export async function editDecision(
  deps: ReviewDeps,
  ownerId: string,
  meetingId: string,
  decisionId: string,
  rawText: unknown,
): Promise<Result<void, ReviewError>> {
  const gate = await editableMeeting(deps, ownerId, meetingId);
  if (!gate.ok) return gate;
  const text = normalizeDecisionText(rawText);
  if (!text.ok) return err({ kind: "invalid", errors: [text.error] });
  return toResult(
    await deps.reviews.editDecision(ownerId, meetingId, decisionId, text.value, deps.clock.now()),
  );
}

export async function deleteDecision(
  deps: ReviewDeps,
  ownerId: string,
  meetingId: string,
  decisionId: string,
): Promise<Result<void, ReviewError>> {
  const gate = await editableMeeting(deps, ownerId, meetingId);
  if (!gate.ok) return gate;
  return toResult(
    await deps.reviews.deleteDecision(ownerId, meetingId, decisionId, deps.clock.now()),
  );
}

export interface ActionItemInput {
  text: unknown;
  assignee: unknown;
  due: unknown;
  done: boolean;
}

/** Validates the form against the meeting's own zone; null when the meeting is not the owner's. */
async function actionItemFields(
  deps: ReviewDeps,
  ownerId: string,
  meetingId: string,
  input: ActionItemInput,
) {
  const timezone = await deps.reviews.timezoneOf(ownerId, meetingId);
  if (timezone === null) return err(MISSING);
  const fields = normalizeActionItemInput(input, timezone);
  return fields.ok ? ok(fields.value) : err<ReviewError>({ kind: "invalid", errors: fields.error });
}

export async function addActionItem(
  deps: ReviewDeps,
  ownerId: string,
  meetingId: string,
  input: ActionItemInput,
): Promise<Result<void, ReviewError>> {
  const gate = await editableMeeting(deps, ownerId, meetingId);
  if (!gate.ok) return gate;
  const fields = await actionItemFields(deps, ownerId, meetingId, input);
  if (!fields.ok) return fields;
  return toResult(
    await deps.reviews.addActionItem(ownerId, meetingId, fields.value, deps.clock.now()),
  );
}

export async function editActionItem(
  deps: ReviewDeps,
  ownerId: string,
  meetingId: string,
  itemId: string,
  input: ActionItemInput,
): Promise<Result<void, ReviewError>> {
  const gate = await editableMeeting(deps, ownerId, meetingId);
  if (!gate.ok) return gate;
  const fields = await actionItemFields(deps, ownerId, meetingId, input);
  if (!fields.ok) return fields;
  return toResult(
    await deps.reviews.editActionItem(ownerId, meetingId, itemId, fields.value, deps.clock.now()),
  );
}

export async function deleteActionItem(
  deps: ReviewDeps,
  ownerId: string,
  meetingId: string,
  itemId: string,
): Promise<Result<void, ReviewError>> {
  const gate = await editableMeeting(deps, ownerId, meetingId);
  if (!gate.ok) return gate;
  return toResult(
    await deps.reviews.deleteActionItem(ownerId, meetingId, itemId, deps.clock.now()),
  );
}

/**
 * Renames a speaker label on every segment of the meeting. Giving a speaker the name of another
 * one merges them. The label as first transcribed stays on each segment.
 */
export async function renameSpeaker(
  deps: ReviewDeps,
  ownerId: string,
  meetingId: string,
  rawFrom: unknown,
  rawTo: unknown,
): Promise<Result<void, ReviewError>> {
  const gate = await editableMeeting(deps, ownerId, meetingId);
  if (!gate.ok) return gate;
  const from = normalizeSpeakerName(rawFrom, "from");
  const to = normalizeSpeakerName(rawTo, "to");
  const errors = [from, to].flatMap((r) => (r.ok ? [] : [r.error]));
  if (!from.ok || !to.ok) return err({ kind: "invalid", errors });
  const changed = await deps.reviews.renameSpeaker(
    ownerId,
    meetingId,
    from.value,
    to.value,
    deps.clock.now(),
  );
  return changed > 0
    ? ok(undefined)
    : err(invalid("from", "That speaker is not in this transcript."));
}

type NoteMove = { status: "published"; folderId: string } | { status: "draft" };
type Plan = Result<{ outcome: TransitionOutcome; note: NoteMove }, ReviewError>;

const alreadyDone = (meeting: Meeting): Plan =>
  ok({ outcome: { meeting, changed: false, events: [], effects: [] }, note: { status: "draft" } });

/** Two attempts: a concurrent change is re-read once, so a racing double submit settles. */
async function applyStatus(
  deps: ReviewDeps,
  ownerId: string,
  meetingId: string,
  plan: (meeting: Meeting) => Promise<Plan>,
): Promise<Result<void, ReviewError>> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const meeting = await deps.meetings.findById(ownerId, meetingId);
    if (!meeting || !canEditMeeting(ownerId, meeting)) return err({ kind: "not_found" });
    const planned = await plan(meeting);
    if (!planned.ok) return planned;
    if (!planned.value.outcome.changed) return ok(undefined);
    const applied = await deps.reviews.applyNoteStatus(
      ownerId,
      meeting,
      planned.value.outcome,
      planned.value.note,
      deps.clock.now(),
    );
    if (applied === "applied") return ok(undefined);
  }
  return err({ kind: "conflict" });
}

/**
 * Publishes the draft into one of the owner's folders. Explicit (the owner must confirm), and
 * idempotent: a note that is already published stays as it is. Another owner's folder and an
 * unknown one are the same validation error.
 */
export function publishNote(
  deps: ReviewDeps,
  ownerId: string,
  meetingId: string,
  input: { folderId: string; confirmed: boolean },
): Promise<Result<void, ReviewError>> {
  return applyStatus(deps, ownerId, meetingId, async (meeting) => {
    if (meeting.status === "published") return alreadyDone(meeting);
    if (meeting.status !== "review") return err({ kind: "not_editable", status: meeting.status });
    if (!input.confirmed) {
      return err(invalid("confirm", "Tick the box to confirm you want to publish."));
    }
    const folder = await deps.folders.find(ownerId, input.folderId);
    if (!folder) return err(invalid("folder", "Choose one of your folders."));
    const outcome = publishMeeting(meeting, { id: folder.id, ownerId }, deps.clock.now());
    if (!outcome.ok) return err({ kind: "not_editable", status: meeting.status });
    return ok({ outcome: outcome.value, note: { status: "published", folderId: folder.id } });
  });
}

/** Published back to draft so it can be edited again; a draft is left alone. */
export function reopenNote(
  deps: ReviewDeps,
  ownerId: string,
  meetingId: string,
): Promise<Result<void, ReviewError>> {
  return applyStatus(deps, ownerId, meetingId, (meeting) => {
    if (meeting.status === "review") return Promise.resolve(alreadyDone(meeting));
    const outcome = reopenMeeting(meeting, deps.clock.now());
    if (!outcome.ok) return Promise.resolve(err({ kind: "not_editable", status: meeting.status }));
    return Promise.resolve(ok({ outcome: outcome.value, note: { status: "draft" } }));
  });
}

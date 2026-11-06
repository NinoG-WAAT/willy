import { canViewMeeting } from "../../domain/authz/predicates";
import { completeProcessing } from "../../domain/meetings/lifecycle";
import { toNewDraft } from "../../domain/notes/draft";
import type { SummarizerInput, SummaryDraft } from "../../domain/notes/summary";
import { builtinTemplate } from "../../domain/notes/template";
import { segmentTextContext } from "../../domain/transcription/encryption-context";
import { currentLocale } from "../../i18n/translate";
import type { Clock } from "../../ports/clock";
import type { Logger } from "../../ports/logger";
import type { JobRow } from "../../ports/job-repository";
import type { MeetingRepository } from "../../ports/meeting-repository";
import type { NoteRepository, SummaryContext } from "../../ports/note-repository";
import type { Summarizer } from "../../ports/summarizer";
import type { TemplateRepository } from "../../ports/template-repository";
import type { TextCipher } from "../../ports/text-cipher";
import type { VocabularyRepository } from "../../ports/vocabulary-repository";
import type { JobHandler, JobOutcome } from "../jobs/runner";
import { failMeetingProcessing } from "../meetings/fail-processing";

export interface SummaryDeps {
  meetings: MeetingRepository;
  notes: NoteRepository;
  templates: TemplateRepository;
  /** The owner's own spellings, handed to the summarizer so names are written the way the owner writes them. */
  vocabulary: VocabularyRepository;
  summarizer: Summarizer;
  textCipher: TextCipher;
  clock: Clock;
  logger: Logger;
}

const EMPTY_SUMMARY: SummaryDraft = { sections: [], decisions: [], actionItems: [] };

export function summaryJobHandler(deps: SummaryDeps): JobHandler {
  return {
    kind: "summarize",
    run: (job, log) =>
      typeof job.payload["sectionId"] === "string"
        ? regenerateSection(deps, job, log)
        : job.payload["scope"] === "all"
          ? regenerateDraft(deps, job, log)
          : generateDraft(deps, job, log),
  };
}

/** Sections the model should write: the meeting's template, else the owner's default, else ours. */
async function templateSections(
  deps: SummaryDeps,
  ownerId: string,
  templateId: string | null,
): Promise<{ heading: string; prompt: string }[]> {
  const chosen =
    (templateId === null ? null : await deps.templates.find(ownerId, templateId)) ??
    (await deps.templates.findDefault(ownerId));
  const sections = chosen?.sections ?? builtinTemplate().sections;
  return sections.map((s) => ({ heading: s.heading, prompt: s.prompt }));
}

/**
 * The owner's terms for the summarizer, in list order. They only improve spelling, so a failure to
 * read them never fails a summary: it warns with a count of 0 and goes on. Terms are never logged.
 */
async function loadVocabulary(deps: SummaryDeps, log: Logger, ownerId: string): Promise<string[]> {
  try {
    return (await deps.vocabulary.list(ownerId)).map((t) => t.term);
  } catch {
    log.warn("job.vocabulary_unavailable", { vocabularyTerms: 0 });
    return [];
  }
}

/** Decrypts the transcript for the model; null if any segment is unreadable. */
async function readTranscript(
  deps: SummaryDeps,
  context: SummaryContext,
): Promise<SummarizerInput["segments"] | null> {
  const segments = [];
  for (const s of context.segments) {
    try {
      const text = await deps.textCipher.decrypt(s.textCiphertext, segmentTextContext(s.id));
      segments.push({ position: s.position, speaker: s.speaker, text });
    } catch {
      return null;
    }
  }
  return segments;
}

/**
 * Generates the draft Note after transcription: the model's answer is verified server-side
 * (grounded in real transcript ranges, attendees from the list only), stored as a **draft**
 * together with its source links, and the meeting moves `processing -> review`. Idempotent: a
 * meeting has one note, and a replay or a meeting that is no longer processing changes nothing.
 */
async function generateDraft(deps: SummaryDeps, job: JobRow, log: Logger): Promise<JobOutcome> {
  const { ownerId, meetingId } = job;
  const meeting = meetingId === null ? null : await deps.meetings.findById(ownerId, meetingId);
  if (
    meetingId === null ||
    !meeting ||
    !canViewMeeting(ownerId, meeting) ||
    meeting.status !== "processing"
  ) {
    log.info("job.skipped", { reason: "meeting_not_processing" });
    return { kind: "succeeded" };
  }
  const context = await deps.notes.loadSummaryContext(ownerId, meetingId);
  if (!context) return { kind: "succeeded" };

  const giveUp = async (errorCode: string): Promise<JobOutcome> => {
    await failMeetingProcessing(deps, log, meeting);
    return { kind: "failed", errorCode };
  };

  const segments = await readTranscript(deps, context);
  if (segments === null) return giveUp("transcript_unreadable");

  let summary = EMPTY_SUMMARY;
  if (segments.length > 0) {
    const result = await deps.summarizer.summarize({
      segments,
      agenda: context.agenda,
      attendees: context.attendees,
      template: { sections: await templateSections(deps, ownerId, context.templateId) },
      only: null,
      vocabulary: await loadVocabulary(deps, log, ownerId),
      language: currentLocale(),
    });
    if (!result.ok) {
      const errorCode = `llm_${result.error.kind}`;
      log.warn("summary.failed", { errorCode, retryable: result.error.retryable });
      if (!result.error.retryable || job.attempts >= job.maxAttempts) return giveUp(errorCode);
      return { kind: "retry", errorCode };
    }
    summary = result.value;
  }

  const now = deps.clock.now();
  const completed = completeProcessing(meeting, now);
  if (!completed.ok) return { kind: "succeeded" };
  const saved = await deps.notes.saveDraft(
    ownerId,
    meeting,
    toNewDraft(summary, { timezone: context.timezone }),
    completed.value,
    now,
  );
  if (saved === "conflict") return { kind: "retry", errorCode: "conflict" };
  log.info("summary.saved", {
    result: saved,
    sections: summary.sections.length,
    decisions: summary.decisions.length,
    actionItems: summary.actionItems.length,
  });
  return { kind: "succeeded" };
}

const GENERIC_PROMPT = "Write this section from the transcript, covering only what was said.";

/** The template's prompt for a heading, or a generic one (the section may predate the template). */
async function promptFor(
  deps: SummaryDeps,
  ownerId: string,
  templateId: string | null,
  heading: string,
): Promise<string> {
  const wanted = heading.trim().toLowerCase();
  const found = (await templateSections(deps, ownerId, templateId)).find(
    (s) => s.heading.trim().toLowerCase() === wanted,
  );
  return found?.prompt ?? GENERIC_PROMPT;
}

/**
 * Regenerate-for-selection: asks for ONE section, with the same input and the same server-side
 * verification as the first draft, and replaces only that section (it becomes unedited). Decisions,
 * action items and every other section keep their manual edits. The note revision is compared and
 * raised in the same transaction, so a replayed job, a deleted section or a note that was
 * published meanwhile changes nothing. A failure never fails the meeting: the draft stays as it was.
 */
async function regenerateSection(deps: SummaryDeps, job: JobRow, log: Logger): Promise<JobOutcome> {
  const { ownerId, meetingId } = job;
  const sectionId = String(job.payload["sectionId"]);
  const revision = Number(job.payload["revision"]);
  const meeting = meetingId === null ? null : await deps.meetings.findById(ownerId, meetingId);
  if (
    meetingId === null ||
    !meeting ||
    !canViewMeeting(ownerId, meeting) ||
    meeting.status !== "review"
  ) {
    log.info("job.skipped", { reason: "meeting_not_in_review" });
    return { kind: "succeeded" };
  }
  const section = await deps.notes.findSection(ownerId, meetingId, sectionId);
  if (!section || section.noteStatus !== "draft" || section.noteRevision !== revision) {
    log.info("job.skipped", { reason: section ? "stale_revision" : "section_missing" });
    return { kind: "succeeded" };
  }
  const context = await deps.notes.loadSummaryContext(ownerId, meetingId);
  if (!context) return { kind: "succeeded" };
  const segments = await readTranscript(deps, context);
  if (segments === null) return { kind: "failed", errorCode: "transcript_unreadable" };
  if (segments.length === 0) return { kind: "succeeded" };

  const result = await deps.summarizer.summarize({
    segments,
    agenda: context.agenda,
    attendees: context.attendees,
    template: null,
    only: {
      heading: section.heading,
      prompt: await promptFor(deps, ownerId, context.templateId, section.heading),
    },
    vocabulary: await loadVocabulary(deps, log, ownerId),
    language: currentLocale(),
  });
  if (!result.ok) {
    const errorCode = `llm_${result.error.kind}`;
    log.warn("summary.regeneration_failed", { errorCode, retryable: result.error.retryable });
    if (!result.error.retryable || job.attempts >= job.maxAttempts) {
      return { kind: "failed", errorCode };
    }
    return { kind: "retry", errorCode };
  }
  const replacement = result.value.sections[0];
  if (!replacement) return { kind: "retry", errorCode: "llm_unavailable" };

  const replaced = await deps.notes.replaceSection(
    ownerId,
    meetingId,
    sectionId,
    revision,
    replacement,
    deps.clock.now(),
  );
  log.info("summary.section_regenerated", { result: replaced });
  return { kind: "succeeded" };
}

/**
 * Regenerate-whole-draft: the same input and the same server-side verification as the first
 * draft, but the result replaces every section, decision and action item of the draft note in one
 * transaction (the note revision is compared and raised there, so a replayed job, an edit made
 * meanwhile or a note published meanwhile changes nothing). A failure never fails the meeting and
 * never touches the draft; with no transcript there is nothing to write from, so nothing is wiped.
 */
async function regenerateDraft(deps: SummaryDeps, job: JobRow, log: Logger): Promise<JobOutcome> {
  const { ownerId, meetingId } = job;
  const revision = Number(job.payload["revision"]);
  const meeting = meetingId === null ? null : await deps.meetings.findById(ownerId, meetingId);
  if (
    meetingId === null ||
    !meeting ||
    !canViewMeeting(ownerId, meeting) ||
    meeting.status !== "review"
  ) {
    log.info("job.skipped", { reason: "meeting_not_in_review" });
    return { kind: "succeeded" };
  }
  const note = await deps.notes.findNote(ownerId, meetingId);
  if (!note || note.noteStatus !== "draft" || note.noteRevision !== revision) {
    log.info("job.skipped", { reason: note ? "stale_revision" : "note_missing" });
    return { kind: "succeeded" };
  }
  const context = await deps.notes.loadSummaryContext(ownerId, meetingId);
  if (!context) return { kind: "succeeded" };
  const segments = await readTranscript(deps, context);
  if (segments === null) return { kind: "failed", errorCode: "transcript_unreadable" };
  if (segments.length === 0) {
    log.info("job.skipped", { reason: "no_transcript" });
    return { kind: "succeeded" };
  }

  const result = await deps.summarizer.summarize({
    segments,
    agenda: context.agenda,
    attendees: context.attendees,
    template: { sections: await templateSections(deps, ownerId, context.templateId) },
    only: null,
    vocabulary: await loadVocabulary(deps, log, ownerId),
    language: currentLocale(),
  });
  if (!result.ok) {
    const errorCode = `llm_${result.error.kind}`;
    log.warn("summary.regeneration_failed", { errorCode, retryable: result.error.retryable });
    if (!result.error.retryable || job.attempts >= job.maxAttempts) {
      return { kind: "failed", errorCode };
    }
    return { kind: "retry", errorCode };
  }

  const replaced = await deps.notes.replaceDraft(
    ownerId,
    meetingId,
    revision,
    toNewDraft(result.value, { timezone: context.timezone }),
    deps.clock.now(),
  );
  log.info("summary.draft_regenerated", {
    result: replaced,
    sections: result.value.sections.length,
    decisions: result.value.decisions.length,
    actionItems: result.value.actionItems.length,
  });
  return { kind: "succeeded" };
}

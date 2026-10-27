import { canViewMeeting } from "../../domain/authz/predicates";
import { completeProcessing } from "../../domain/meetings/lifecycle";
import { toNewDraft } from "../../domain/notes/draft";
import type { SummarizerInput, SummaryDraft } from "../../domain/notes/summary";
import { DEFAULT_TEMPLATE } from "../../domain/notes/template";
import { segmentTextContext } from "../../domain/transcription/encryption-context";
import type { Clock } from "../../ports/clock";
import type { Logger } from "../../ports/logger";
import type { MeetingRepository } from "../../ports/meeting-repository";
import type { NoteRepository, SummaryContext } from "../../ports/note-repository";
import type { Summarizer } from "../../ports/summarizer";
import type { TemplateRepository } from "../../ports/template-repository";
import type { TextCipher } from "../../ports/text-cipher";
import type { JobHandler, JobOutcome } from "../jobs/runner";
import { failMeetingProcessing } from "../meetings/fail-processing";

export interface SummaryDeps {
  meetings: MeetingRepository;
  notes: NoteRepository;
  templates: TemplateRepository;
  summarizer: Summarizer;
  textCipher: TextCipher;
  clock: Clock;
  logger: Logger;
}

const EMPTY_SUMMARY: SummaryDraft = { sections: [], decisions: [], actionItems: [] };

export function summaryJobHandler(deps: SummaryDeps): JobHandler {
  return { kind: "summarize", run: (job, log) => generateDraft(deps, job, log) };
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
  const sections = chosen?.sections ?? DEFAULT_TEMPLATE.sections;
  return sections.map((s) => ({ heading: s.heading, prompt: s.prompt }));
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
async function generateDraft(
  deps: SummaryDeps,
  job: { ownerId: string; meetingId: string | null; attempts: number; maxAttempts: number },
  log: Logger,
): Promise<JobOutcome> {
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

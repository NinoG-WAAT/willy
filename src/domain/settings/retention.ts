import { err, ok, type Result } from "../platform/result";
import type { FieldError } from "../platform/text";

export interface RetentionSettings {
  /** Hours raw audio is kept after transcription; 0 deletes it right after (the default). */
  rawAudioRetentionHours: number;
  /** Days after a meeting's scheduled start before it is permanently deleted; null keeps it. */
  noteRetentionDays: number | null;
}

export const DEFAULT_RETENTION: RetentionSettings = {
  rawAudioRetentionHours: 0,
  noteRetentionDays: null,
};

// The database allows 0..168 hours (7 days) for audio and any whole number of days for notes.
const RAW_AUDIO_HOURS = [0, 24, 72, 168] as const;
const NOTE_DAYS = [30, 90, 180, 365] as const;

/** A stored value outside the list (set by an operator) stays selectable so saving never changes it. */
const withCurrent = (choices: readonly number[], current: number | null): number[] =>
  [...new Set(current === null ? choices : [...choices, current])].sort((a, b) => a - b);

export const rawAudioChoices = (current: number): number[] => withCurrent(RAW_AUDIO_HOURS, current);

export const noteRetentionChoices = (current: number | null): number[] =>
  withCurrent(NOTE_DAYS, current);

const plural = (n: number, one: string, many: string) => `${String(n)} ${n === 1 ? one : many}`;

export function describeRawAudioRetention(hours: number): string {
  if (hours === 0) return "Delete right after successful transcription (default)";
  const span =
    hours % 24 === 0 ? plural(hours / 24, "day", "days") : plural(hours, "hour", "hours");
  return `Keep for ${span} after transcription`;
}

export function describeNoteRetention(days: number | null): string {
  return days === null
    ? "Keep notes and transcripts until you delete them (default)"
    : `Permanently delete meetings ${plural(days, "day", "days")} after their scheduled start`;
}

export interface RetentionInput {
  rawAudioRetentionHours: string | undefined;
  /** "off" or a number of days. */
  noteRetentionDays: string | undefined;
  /** The owner ticked the acknowledgement that notes will be deleted automatically. */
  acknowledged: boolean;
}

/** Whole non-negative integers only: no signs, spaces, decimals, exponents or hex. */
const wholeNumber = (raw: string | undefined): number | null =>
  raw !== undefined && /^\d{1,4}$/.test(raw) ? Number(raw) : null;

/**
 * Validates the retention form against the fixed choices (plus the value already stored). Making
 * notes expire, or making the period shorter, deletes meetings automatically and cannot be
 * undone, so it needs the explicit acknowledgement; a longer period or "off" never does.
 */
export function parseRetention(
  input: RetentionInput,
  current: RetentionSettings,
): Result<RetentionSettings, FieldError[]> {
  const errors: FieldError[] = [];

  const hours = wholeNumber(input.rawAudioRetentionHours);
  if (hours === null || !rawAudioChoices(current.rawAudioRetentionHours).includes(hours)) {
    errors.push({
      field: "raw_audio_retention_hours",
      message: "Choose how long raw audio is kept from the list.",
    });
  }

  let days: number | null = null;
  if (input.noteRetentionDays !== "off") {
    days = wholeNumber(input.noteRetentionDays);
    if (days === null || !noteRetentionChoices(current.noteRetentionDays).includes(days)) {
      errors.push({
        field: "note_retention_days",
        message: "Choose how long notes are kept from the list.",
      });
    }
  }

  if (errors.length > 0 || hours === null) return err(errors);

  const startsOrShortens =
    days !== null && (current.noteRetentionDays === null || days < current.noteRetentionDays);
  if (startsOrShortens && !input.acknowledged) {
    return err([
      {
        field: "acknowledge_note_retention",
        message: "Tick the box to confirm that older meetings will be deleted permanently.",
      },
    ]);
  }
  return ok({ rawAudioRetentionHours: hours, noteRetentionDays: days });
}

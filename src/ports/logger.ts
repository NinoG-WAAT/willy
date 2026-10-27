export type LogFields = Record<string, string | number | boolean | null | undefined>;

/**
 * Structured logging. Fields carry ids, counts and codes only: never secrets, audio, transcript
 * or note text, or attendee emails (CLAUDE.md A09). Implementations redact by field name as a
 * second line of defence; callers must not rely on it.
 */
export interface Logger {
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
  /** A logger that adds `fields` (for example `jobId`, `correlationId`) to every line. */
  child(fields: LogFields): Logger;
}

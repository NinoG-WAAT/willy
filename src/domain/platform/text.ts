/** A problem with one input field, ready to show next to that field. */
export interface FieldError {
  /** Form field name, or a dotted path such as `sections.2.heading`. */
  field: string;
  message: string;
}

/** Single-line text: NFC, control characters and line breaks become spaces, whitespace collapsed, trimmed. */
export function normalizeLine(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  return raw
    .normalize("NFC")
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Multi-line text: NFC, CRLF unified, control characters removed (newlines kept), blank runs capped, trimmed. */
export function normalizeMultiline(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  return raw
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/[^\P{Cc}\n]/gu, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

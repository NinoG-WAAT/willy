/** Emails are stored lower-case NFC; lookups use the same form. */
export function normalizeEmail(raw: string): string {
  return raw.normalize("NFC").trim().toLowerCase();
}

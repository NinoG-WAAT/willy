import { err, ok, type Result } from "../platform/result";
import { normalizeLine, type FieldError } from "../platform/text";

/** Minimum personal data: a name and, optionally, an email. Never implies consent. */
export interface Attendee {
  name: string;
  email: string | null;
}

export const ATTENDEE_LIMITS = { count: 100, name: 100, email: 254 } as const;

const ATTENDEE_KEYS = new Set(["name", "email"]);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Validates and normalizes untrusted attendee data (calendar payloads or the new-note form):
 * trimmed, NFC, emails lower-cased and de-duplicated. With neither name nor email there is nobody
 * to keep, so the entry is dropped: an attendee is never invented.
 */
export function normalizeAttendees(raw: unknown): Result<Attendee[], FieldError> {
  const fail = (message: string) => err({ field: "attendees", message });
  if (!Array.isArray(raw)) return fail("Attendees must be a list.");
  if (raw.length > ATTENDEE_LIMITS.count) {
    return fail(`Add at most ${String(ATTENDEE_LIMITS.count)} attendees.`);
  }
  const byEmail = new Set<string>();
  const out: Attendee[] = [];
  for (const item of raw) {
    if (!isRecord(item) || !Object.keys(item).every((k) => ATTENDEE_KEYS.has(k))) {
      return fail("Unexpected attendee data.");
    }
    const name = normalizeLine(item["name"]) ?? "";
    const rawEmail =
      item["email"] === null || item["email"] === undefined ? "" : normalizeLine(item["email"]);
    if (rawEmail === null) return fail("Attendee emails must be text.");
    const email = rawEmail.toLowerCase();
    if (email !== "" && (email.length > ATTENDEE_LIMITS.email || !EMAIL.test(email))) {
      return fail(`"${email.slice(0, 40)}" is not a valid email address.`);
    }
    if (name.length > ATTENDEE_LIMITS.name) {
      return fail(`Attendee names can be at most ${String(ATTENDEE_LIMITS.name)} characters.`);
    }
    if (name === "" && email === "") continue;
    if (email !== "") {
      if (byEmail.has(email)) continue;
      byEmail.add(email);
    }
    out.push({ name: name === "" ? email : name, email: email === "" ? null : email });
  }
  return ok(out);
}

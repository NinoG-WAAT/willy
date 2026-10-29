import { ICS_LIMITS } from "../../domain/calendar/ics";
import { isIanaZone } from "../../domain/calendar/windows-timezones";
import { err, ok, type Result } from "../../domain/platform/result";

export type IcsFormErrorCode =
  | "malformed"
  | "no_input"
  | "both_sources"
  | "wrong_type"
  | "too_large"
  | "bad_encoding"
  | "bad_zone";

export interface IcsFormError {
  code: IcsFormErrorCode;
}

export interface IcsUpload {
  text: string;
  /** IANA zone for events that carry none of their own. */
  floatingZone: string;
}

export interface IcsConfirmation extends IcsUpload {
  selectedIds: string[];
}

const UPLOAD_FIELDS = new Set(["csrf_token", "file", "ics_text", "floating_zone"]);
const CONFIRM_FIELDS = new Set(["csrf_token", "ics_text", "floating_zone", "event"]);
/** Browsers disagree on the type of an .ics file; the extension is the stricter test. */
const FILE_TYPES = new Set([
  "",
  "text/calendar",
  "text/plain",
  "text/x-vcalendar",
  "application/ics",
  "application/octet-stream",
]);
const MAX_ID_LENGTH = 300;

const fail = (code: IcsFormErrorCode) => err({ code });

/** Exactly one value per field name, and only the names the form has. Files are only allowed where stated. */
function collect(
  form: FormData,
  allowed: ReadonlySet<string>,
  repeatable: string,
): Map<string, FormDataEntryValue[]> | null {
  const fields = new Map<string, FormDataEntryValue[]>();
  for (const [name, value] of form.entries()) {
    if (!allowed.has(name)) return null;
    const seen = fields.get(name) ?? [];
    if (seen.length > 0 && name !== repeatable) return null;
    fields.set(name, [...seen, value]);
  }
  return fields;
}

function zoneOf(raw: FormDataEntryValue | undefined): Result<string, IcsFormError> {
  if (raw === undefined || raw === "") return ok("UTC");
  if (typeof raw !== "string" || !isIanaZone(raw.trim())) return fail("bad_zone");
  return ok(raw.trim());
}

const utf8Length = (text: string) => new TextEncoder().encode(text).length;

/**
 * Reads the upload form: either one .ics file or pasted text (not both), a UTF-8 body within the
 * size limit, and the zone for floating times. Unknown fields make the whole form malformed.
 * Nothing is stored; the text lives only for this request.
 */
export async function readIcsUpload(form: FormData): Promise<Result<IcsUpload, IcsFormError>> {
  const fields = collect(form, UPLOAD_FIELDS, "");
  if (!fields) return fail("malformed");
  const zone = zoneOf(fields.get("floating_zone")?.[0]);
  if (!zone.ok) return zone;
  const token = fields.get("csrf_token")?.[0];
  if (token !== undefined && typeof token !== "string") return fail("malformed");

  const pasted = fields.get("ics_text")?.[0];
  if (pasted !== undefined && typeof pasted !== "string") return fail("malformed");
  const file = fields.get("file")?.[0];
  if (file !== undefined && typeof file === "string") return fail("malformed");
  // A browser submits an empty, nameless file part when nothing was chosen.
  const chosen = file !== undefined && (file.size > 0 || file.name !== "") ? file : undefined;
  const hasText = pasted !== undefined && pasted.trim() !== "";
  if (chosen && hasText) return fail("both_sources");
  if (!chosen && !hasText) return fail("no_input");

  if (chosen) {
    if (!/\.ics$/i.test(chosen.name)) return fail("wrong_type");
    const type = (chosen.type.split(";")[0] ?? "").trim().toLowerCase();
    if (!FILE_TYPES.has(type)) return fail("wrong_type");
    if (chosen.size > ICS_LIMITS.maxBytes) return fail("too_large");
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(await chosen.arrayBuffer());
      return ok({ text, floatingZone: zone.value });
    } catch {
      return fail("bad_encoding");
    }
  }
  const text = pasted ?? "";
  if (text.length > ICS_LIMITS.maxBytes || utf8Length(text) > ICS_LIMITS.maxBytes) {
    return fail("too_large");
  }
  return ok({ text, floatingZone: zone.value });
}

/** Reads the confirm form: the calendar text again, the zone, and the ids of the events ticked. */
export function readIcsConfirm(form: FormData): Result<IcsConfirmation, IcsFormError> {
  const fields = collect(form, CONFIRM_FIELDS, "event");
  if (!fields) return fail("malformed");
  const text = fields.get("ics_text")?.[0];
  if (typeof text !== "string") return fail("malformed");
  if (text.length > ICS_LIMITS.maxBytes || utf8Length(text) > ICS_LIMITS.maxBytes) {
    return fail("too_large");
  }
  const zone = zoneOf(fields.get("floating_zone")?.[0]);
  if (!zone.ok) return zone;
  const ids = fields.get("event") ?? [];
  if (ids.length > ICS_LIMITS.maxEvents) return fail("malformed");
  const selectedIds: string[] = [];
  for (const id of ids) {
    if (typeof id !== "string" || id === "" || id.length > MAX_ID_LENGTH) return fail("malformed");
    selectedIds.push(id);
  }
  return ok({ text, floatingZone: zone.value, selectedIds });
}

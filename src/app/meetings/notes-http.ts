import { MAX_ROUGH_NOTES_CHARS } from "../../domain/meetings/rough-notes";
import type { Result } from "../../domain/platform/result";
import type { NotesError } from "../notes/errors";

export interface SaveNotesRequest {
  /** From the session, never from the request. */
  ownerId: string;
  /** From the URL path. */
  meetingId: string;
  contentType: string | null;
  body: string;
}

export interface NotesHttpResult {
  status: number;
  body: Record<string, unknown>;
}

export type SaveNotesFn = (
  ownerId: string,
  meetingId: string,
  roughNotes: string,
) => Promise<Result<{ savedAt: string }, NotesError>>;

/** JSON escapes can expand text (up to 6 bytes per character), so bound the raw body generously. */
const MAX_BODY_CHARS = MAX_ROUGH_NOTES_CHARS * 4;
/** Declared size above which the body is not even read (UTF-8 is at most 4 bytes per character). */
export const MAX_BODY_BYTES = MAX_BODY_CHARS * 4;

const reply = (status: number, body: Record<string, unknown>): NotesHttpResult => ({
  status,
  body,
});

/**
 * HTTP adapter for the autosave endpoint: `POST /api/meetings/:id/notes` with
 * `{"roughNotes": "..."}`. Owner and meeting come from the session and path; the body is strict
 * (exactly one string field) and bounded; error bodies are fixed codes that echo nothing.
 * Session and CSRF are enforced earlier, by the middleware.
 */
export async function handleSaveNotes(
  save: SaveNotesFn,
  request: SaveNotesRequest,
): Promise<NotesHttpResult> {
  if (!request.contentType?.toLowerCase().startsWith("application/json")) {
    return reply(415, { error: "unsupported_media_type" });
  }
  if (request.body.length > MAX_BODY_CHARS) return reply(413, { error: "body_too_large" });

  let data: unknown;
  try {
    data = JSON.parse(request.body);
  } catch {
    return reply(400, { error: "bad_request" });
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return reply(400, { error: "bad_request" });
  }
  const keys = Object.keys(data);
  const notes = (data as Record<string, unknown>)["roughNotes"];
  if (keys.length !== 1 || typeof notes !== "string") return reply(400, { error: "bad_request" });

  const result = await save(request.ownerId, request.meetingId, notes);
  if (result.ok) return reply(200, { savedAt: result.value.savedAt });
  if (result.error.kind === "not_found") return reply(404, { error: "not_found" });
  return reply(422, { error: "notes_too_long" });
}

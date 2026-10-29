import { ICS_LIMITS } from "../../domain/calendar/ics";
import { standalonePage } from "../platform/standalone-page";

/**
 * Both ICS posts carry a whole calendar (the upload, or the text sent back to confirm it). The
 * limit is the calendar limit with room for multipart framing and form encoding, which can make
 * a text field up to three times larger on the wire. The calendar limit itself is enforced on the
 * decoded text by the use case.
 */
const ICS_BODY_BYTES = 4 * ICS_LIMITS.maxBytes;

/** The request body cap for a route, or null when the route does not carry large bodies. */
export function maxBodyBytesFor(method: string, pathname: string): number | null {
  if (method.toUpperCase() !== "POST") return null;
  return /^\/meetings\/import\/ics(\/confirm)?$/.test(pathname) ? ICS_BODY_BYTES : null;
}

/**
 * Judges a Content-Length header before anything reads the body: 413 when it is over the limit,
 * 411 when it is missing or not a plain number (a chunked body has no declared size to trust).
 * The HTTP server stops reading at the declared length, so the header bounds what is buffered.
 */
export function checkBodyLength(header: string | null, limit: number): 411 | 413 | null {
  if (header === null || !/^\d+$/.test(header)) return 411;
  if (header.length > 15 || Number(header) > limit) return 413;
  return null;
}

export function bodyTooLargeResponse(status: 411 | 413): Response {
  const message =
    status === 413
      ? "That upload is too large. Export a shorter date range from your calendar and try again."
      : "That upload could not be sized. Try again from the import page.";
  return new Response(
    standalonePage(
      status === 413 ? "Upload too large" : "Upload not accepted",
      `<p>${message}</p><p><a href="/meetings/import/ics">Back to the calendar file import</a></p>`,
    ),
    {
      status,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    },
  );
}

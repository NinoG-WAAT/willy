import type { APIRoute } from "astro";
import { requireOwner } from "../../../../app/identity/require-owner";
import { getProcessingStatus } from "../../../../app/transcription/processing-status";
import { isValidStorageId } from "../../../../domain/storage/object-key";
import { getStatusDeps } from "../../../../composition";

export const prerender = false;

const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };

// Owner route (GET is read-only, so no CSRF token). Polled by the live note and review screens.
export const GET: APIRoute = async ({ params, locals }) => {
  const owner = requireOwner(locals);
  const meetingId = params["id"] ?? "";
  const result = isValidStorageId(meetingId)
    ? await getProcessingStatus(getStatusDeps(), owner.id, meetingId)
    : null;
  if (!result?.ok) {
    return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers });
  }
  return new Response(JSON.stringify(result.value), { status: 200, headers });
};

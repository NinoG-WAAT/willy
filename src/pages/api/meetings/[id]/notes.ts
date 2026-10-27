import type { APIRoute } from "astro";
import { requireOwner } from "../../../../app/identity/require-owner";
import { saveRoughNotes } from "../../../../app/meetings/live-note";
import { handleSaveNotes, MAX_BODY_BYTES } from "../../../../app/meetings/notes-http";
import { isValidStorageId } from "../../../../domain/storage/object-key";
import { getLiveNoteDeps } from "../../../../composition";

export const prerender = false;

const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };

// Owner route: the middleware has already verified the session, Origin and X-CSRF-Token.
export const POST: APIRoute = async ({ request, params, locals }) => {
  const owner = requireOwner(locals);
  const meetingId = params["id"] ?? "";
  // An id that cannot exist looks exactly like one that belongs to someone else.
  if (!isValidStorageId(meetingId)) {
    return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers });
  }
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return new Response(JSON.stringify({ error: "body_too_large" }), { status: 413, headers });
  }
  const deps = getLiveNoteDeps();
  const result = await handleSaveNotes(
    (ownerId, id, roughNotes) => saveRoughNotes(deps, ownerId, id, roughNotes),
    {
      ownerId: owner.id,
      meetingId,
      contentType: request.headers.get("content-type"),
      body: await request.text(),
    },
  );
  return new Response(JSON.stringify(result.body), { status: result.status, headers });
};

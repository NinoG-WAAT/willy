import type { APIRoute } from "astro";
import { requireOwner } from "../../../../app/identity/require-owner";
import { handleChunkUpload } from "../../../../app/transcription/chunk-upload-http";
import { uploadChunk } from "../../../../app/transcription/upload-chunk";
import { isValidStorageId } from "../../../../domain/storage/object-key";
import { getUploadDeps } from "../../../../composition";

export const prerender = false;

const JSON_TYPE = "application/json; charset=utf-8";

// Owner route: the middleware has already verified the session, Origin and X-CSRF-Token.
export const POST: APIRoute = async ({ request, params, locals, url }) => {
  const owner = requireOwner(locals);
  const meetingId = params["id"] ?? "";
  // An id that cannot exist looks exactly like one that belongs to someone else.
  if (!isValidStorageId(meetingId)) {
    return new Response(JSON.stringify({ error: "not_found" }), {
      status: 404,
      headers: { "Content-Type": JSON_TYPE, "Cache-Control": "no-store" },
    });
  }
  const deps = getUploadDeps();
  const result = await handleChunkUpload(
    (ownerId, id, chunk) => uploadChunk(deps, ownerId, id, chunk),
    {
      ownerId: owner.id,
      meetingId,
      search: url.search,
      contentType: request.headers.get("content-type"),
      contentLength: request.headers.get("content-length"),
      body: request.body,
    },
  );
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { ...result.headers, "Content-Type": JSON_TYPE },
  });
};

import type { APIRoute } from "astro";
import { requireOwner } from "../../../../app/identity/require-owner";
import { readFormFields } from "../../../../app/platform/form";
import { removeVocabularyTerm } from "../../../../app/transcription/vocabulary";
import { getVocabularyDeps } from "../../../../composition";

export const prerender = false;

const headers = { "Cache-Control": "no-store" };

/**
 * Remove one word. Owner route: the middleware has verified the session, Origin and CSRF token.
 * Another owner's word and an unknown id give the same plain 404, so ids cannot be probed.
 */
export const POST: APIRoute = async ({ params, locals, request }) => {
  const owner = requireOwner(locals);
  if (!readFormFields(await request.formData(), ["csrf_token"])) {
    return new Response("Bad request", { status: 400, headers });
  }
  const removed = await removeVocabularyTerm(getVocabularyDeps(), owner.id, params["id"] ?? "");
  if (!removed.ok) return new Response(null, { status: 404, headers });
  return new Response(null, {
    status: 303,
    headers: { ...headers, Location: "/settings/vocabulary?notice=vocabulary_removed" },
  });
};

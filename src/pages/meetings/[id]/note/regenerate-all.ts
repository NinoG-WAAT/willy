import type { APIRoute } from "astro";
import { requireOwner } from "../../../../app/identity/require-owner";
import { requestDraftRegeneration } from "../../../../app/notes/regenerate-draft";
import { readFormFields, single } from "../../../../app/platform/form";
import { isValidStorageId } from "../../../../domain/storage/object-key";
import { getRegenerateDeps } from "../../../../composition";

export const prerender = false;

const redirect = (location: string): Response =>
  new Response(null, { status: 303, headers: { Location: location, "Cache-Control": "no-store" } });

const badRequest = (): Response =>
  new Response("Bad request", {
    status: 400,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });

// Owner route: the middleware has already verified the session, Origin and `csrf_token`.
export const POST: APIRoute = async ({ request, params, locals, rewrite }) => {
  const owner = requireOwner(locals);
  const meetingId = params["id"] ?? "";
  if (!isValidStorageId(meetingId)) return rewrite("/404");

  const fields = readFormFields(await request.clone().formData(), ["confirm", "csrf_token"]);
  if (!fields) return badRequest();

  // The box is `required` in the form, but replacing the owner's edits is decided here.
  const result = await requestDraftRegeneration(getRegenerateDeps(), owner.id, meetingId, {
    confirmed: single(fields, "confirm") === "on",
  });
  if (result.ok) {
    return redirect(
      `/meetings/${meetingId}/review?notice=draft_regeneration_queued#regenerate-draft`,
    );
  }
  // Other owners', unknown and deleting meetings all look the same.
  if (result.error.kind === "not_found") return rewrite("/404");
  if (result.error.kind === "not_confirmed") return badRequest();
  return redirect(`/meetings/${meetingId}/review`);
};

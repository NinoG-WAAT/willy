import type { APIRoute } from "astro";
import { requireOwner } from "../../../../app/identity/require-owner";
import { requestSectionRegeneration } from "../../../../app/notes/regenerate-section";
import { readFormFields, single } from "../../../../app/platform/form";
import { isValidStorageId } from "../../../../domain/storage/object-key";
import { getRegenerateDeps } from "../../../../composition";

export const prerender = false;

const redirect = (location: string): Response =>
  new Response(null, { status: 303, headers: { Location: location, "Cache-Control": "no-store" } });

// Owner route: the middleware has already verified the session, Origin and `csrf_token`.
export const POST: APIRoute = async ({ request, params, locals, rewrite }) => {
  const owner = requireOwner(locals);
  const meetingId = params["id"] ?? "";
  if (!isValidStorageId(meetingId)) return rewrite("/404");

  const fields = readFormFields(await request.clone().formData(), ["section_id", "csrf_token"]);
  const sectionId = fields ? single(fields, "section_id") : undefined;
  if (sectionId === undefined || !isValidStorageId(sectionId)) {
    return new Response("Bad request", {
      status: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  const result = await requestSectionRegeneration(
    getRegenerateDeps(),
    owner.id,
    meetingId,
    sectionId,
  );
  if (result.ok) {
    return redirect(
      `/meetings/${meetingId}/review?notice=regeneration_queued#section-${sectionId}`,
    );
  }
  // Other owners', unknown and deleting meetings and sections all look the same.
  if (result.error.kind === "not_found") return rewrite("/404");
  return redirect(`/meetings/${meetingId}/review`);
};

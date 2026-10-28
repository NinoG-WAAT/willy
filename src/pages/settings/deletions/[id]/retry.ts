import type { APIRoute } from "astro";
import { requireOwner } from "../../../../app/identity/require-owner";
import { readFormFields } from "../../../../app/platform/form";
import { retryMeetingDeletion } from "../../../../app/settings/deletion";
import { getDeletionDeps } from "../../../../composition";

export const prerender = false;

const headers = { "Cache-Control": "no-store" };

/**
 * Retry a stopped (failed) deletion. Owner route: the middleware has verified the session, Origin
 * and CSRF token. Another owner's meeting and an unknown id give the same 404.
 */
export const POST: APIRoute = async ({ params, locals, request }) => {
  const owner = requireOwner(locals);
  const fields = readFormFields(await request.formData(), ["csrf_token"]);
  if (!fields) return new Response("Bad request", { status: 400, headers });

  const result = await retryMeetingDeletion(getDeletionDeps(), owner.id, params["id"] ?? "");
  if (!result.ok) return new Response(null, { status: 404, headers });
  const code =
    result.value.outcome === "requeued" ? "deletion_retried" : "deletion_nothing_to_retry";
  return new Response(null, {
    status: 303,
    headers: { ...headers, Location: `/settings?notice=${code}#deletions` },
  });
};

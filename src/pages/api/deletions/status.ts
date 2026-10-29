import type { APIRoute } from "astro";
import { requireOwner } from "../../../app/identity/require-owner";
import { getDeletionProgress } from "../../../app/settings/deletion-progress";
import { getDeletionDeps } from "../../../composition";

export const prerender = false;

// Owner route (GET is read-only, so no CSRF token). Polled by the settings screen while a
// deletion runs. The owner comes from the session; the answer is state and counters only.
export const GET: APIRoute = async ({ locals }) => {
  const owner = requireOwner(locals);
  const deletions = await getDeletionProgress(getDeletionDeps(), owner.id);
  return new Response(JSON.stringify({ deletions }), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
};

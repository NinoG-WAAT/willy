import type { APIRoute } from "astro";
import { requireOwner } from "../../../app/identity/require-owner";
import { runJobsNow } from "../../../composition";

export const prerender = false;

const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };

/**
 * Runs the signed-in owner's due jobs once. For local development and end-to-end tests only: it
 * does not exist unless WILLY_JOBS_ENDPOINT=1 (never set it in production). Still an owner route,
 * so it needs a session and the CSRF token like every other POST, and it never runs another
 * owner's jobs.
 */
export const POST: APIRoute = async ({ locals }) => {
  if (process.env["WILLY_JOBS_ENDPOINT"] !== "1") {
    return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers });
  }
  const owner = requireOwner(locals);
  return new Response(JSON.stringify(await runJobsNow(owner.id)), { status: 200, headers });
};

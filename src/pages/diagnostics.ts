import type { APIRoute } from "astro";
import { requireOwner } from "../app/identity/require-owner";
import { getDiagnostics } from "../app/ops/diagnostics";
import { getDiagnosticsDeps } from "../composition";

export const prerender = false;

// Owner route (middleware default-deny). Read-only; counts and mode names only.
export const GET: APIRoute = async ({ locals }) => {
  const owner = requireOwner(locals);
  const body = await getDiagnostics(getDiagnosticsDeps(), owner.id);
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
};

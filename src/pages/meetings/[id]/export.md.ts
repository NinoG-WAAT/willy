import type { APIRoute } from "astro";
import { requireOwner } from "../../../app/identity/require-owner";
import { EXPORT_LIMIT } from "../../../app/search/limits";
import { exportMeetingMarkdown } from "../../../app/search/export";
import { isValidStorageId } from "../../../domain/storage/object-key";
import { getExportDeps, getRateLimiter } from "../../../composition";

export const prerender = false;

const notFound = () =>
  new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });

// Owner route. GET only reads, so it needs no CSRF token; it is owner-scoped and rate limited.
export const GET: APIRoute = async ({ params, locals }) => {
  const owner = requireOwner(locals);
  const meetingId = params["id"] ?? "";
  // An id that cannot exist looks exactly like another owner's: the same 404.
  if (!isValidStorageId(meetingId)) return notFound();

  const allowed = await getRateLimiter().consume(`export:owner:${owner.id}`, EXPORT_LIMIT);
  if (!allowed.allowed) {
    return new Response("Too many exports. Try again shortly.", {
      status: 429,
      headers: {
        "Retry-After": String(allowed.retryAfterSeconds),
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  const result = await exportMeetingMarkdown(getExportDeps(), owner.id, meetingId);
  if (!result.ok) return notFound();
  return new Response(result.value.markdown, {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      // The filename is ASCII by construction (a-z, 0-9, "-", ".md"), so it is safe to quote.
      "Content-Disposition": `attachment; filename="${result.value.filename}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    },
  });
};

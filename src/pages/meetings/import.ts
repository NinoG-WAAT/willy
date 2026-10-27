import type { APIRoute } from "astro";
import { importUpcomingEvents } from "../../app/calendar/import-upcoming";
import { requireOwner } from "../../app/identity/require-owner";
import { problemCodeFor } from "../../app/meetings/messages";
import { getCalendarImportDeps } from "../../composition";

export const prerender = false;

const redirect = (query: string) =>
  new Response(null, {
    status: 303,
    headers: { Location: `/?${query}`, "Cache-Control": "no-store" },
  });

// Owner route: the middleware has verified the session, Origin and CSRF token.
export const POST: APIRoute = async ({ locals }) => {
  const owner = requireOwner(locals);
  const result = await importUpcomingEvents(getCalendarImportDeps(), owner.id, new Date());
  if (!result.ok) return redirect(`problem=${problemCodeFor(result.error)}`);
  return redirect(
    `notice=imported&new=${String(result.value.created)}&existing=${String(result.value.existing)}`,
  );
};

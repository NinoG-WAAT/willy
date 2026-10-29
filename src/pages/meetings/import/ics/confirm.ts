import type { APIRoute } from "astro";
import { confirmIcsImport } from "../../../../app/calendar/import-ics";
import { readIcsConfirm } from "../../../../app/calendar/ics-form";
import { requireOwner } from "../../../../app/identity/require-owner";
import { getIcsImportDeps } from "../../../../composition";

export const prerender = false;

const see = (location: string) =>
  new Response(null, { status: 303, headers: { Location: location, "Cache-Control": "no-store" } });
const back = (code: string) => see(`/meetings/import/ics?problem=${code}`);

// Owner route: the middleware has verified the session, Origin, CSRF token and body size. The
// owner is the session's; nothing in the form names one.
export const POST: APIRoute = async ({ request, locals }) => {
  const owner = requireOwner(locals);
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return back("malformed");
  }
  const read = readIcsConfirm(form);
  if (!read.ok) return back(read.error.code);

  const result = await confirmIcsImport(getIcsImportDeps(), owner.id, read.value);
  if (!result.ok) return back(result.error.code);

  // Counts only: never the file's text, titles or attendees.
  locals.log?.info("calendar.ics_imported", {
    created: result.value.created,
    existing: result.value.existing,
    selected: read.value.selectedIds.length,
  });
  return see(
    `/?notice=ics_imported&new=${String(result.value.created)}&existing=${String(result.value.existing)}`,
  );
};

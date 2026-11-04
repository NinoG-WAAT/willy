import type { APIRoute } from "astro";
import { requireOwner } from "../../app/identity/require-owner";
import { readFormFields, single } from "../../app/platform/form";
import { saveLanguage } from "../../app/settings/language";
import { getLanguageDeps } from "../../composition";

export const prerender = false;

const headers = { "Cache-Control": "no-store" };

/**
 * Save the owner's interface language. Owner route: the middleware has verified the session,
 * Origin and CSRF token. The owner id comes from the session only; the form has no owner field,
 * and an unknown field makes the whole request a 400. The next request is served in the new
 * language, so the confirmation after the redirect already uses it.
 */
export const POST: APIRoute = async ({ locals, request }) => {
  const owner = requireOwner(locals);
  const fields = readFormFields(await request.formData(), ["csrf_token", "language"]);
  if (!fields) return new Response("Bad request", { status: 400, headers });
  const result = await saveLanguage(getLanguageDeps(), owner.id, single(fields, "language"));
  if (!result.ok) {
    return new Response(result.error.map((e) => e.message).join("\n"), {
      status: 422,
      headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  return new Response(null, {
    status: 303,
    headers: { ...headers, Location: "/settings?notice=language_saved" },
  });
};

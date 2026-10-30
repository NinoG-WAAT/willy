import type { APIRoute } from "astro";

export const prerender = false;

// Folders moved out of Settings to /folders (issue #67). Permanent and method-preserving, so an
// old bookmark, or a form posted from an old page, still lands on the new page. The middleware
// has already checked session, Origin and CSRF for the old URL.
export const ALL: APIRoute = ({ url }) =>
  new Response(null, { status: 308, headers: { Location: `/folders${url.search}` } });

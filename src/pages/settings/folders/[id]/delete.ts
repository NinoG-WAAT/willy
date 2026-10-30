import type { APIRoute } from "astro";

export const prerender = false;

// See ../../folders.ts: the folder pages moved to /folders (issue #67).
export const ALL: APIRoute = ({ params, url }) =>
  new Response(null, {
    status: 308,
    headers: {
      Location: `/folders/${encodeURIComponent(params["id"] ?? "")}/delete${url.search}`,
    },
  });

import { requiresCsrf } from "../../domain/identity/csrf";
import { standalonePage } from "../platform/standalone-page";

export type RouteAccess = "public" | "signature" | "owner";

const PUBLIC_EXACT = new Set(["/healthz", "/sign-in", "/signed-out", "/session-expired"]);
const PUBLIC_PREFIXES = ["/_astro/"];
const PUBLIC_FILE = /^\/favicon\.(svg|ico|png)$/;

/**
 * Default deny: everything needs an Owner session unless listed here. Webhooks authenticate by
 * signature instead (no session, no CSRF) and must verify it themselves.
 */
export function classifyRoute(pathname: string): RouteAccess {
  if (PUBLIC_EXACT.has(pathname) || PUBLIC_FILE.test(pathname)) return "public";
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return "public";
  if (pathname.startsWith("/webhooks/")) return "signature";
  return "owner";
}

export const isApiPath = (pathname: string): boolean => pathname.startsWith("/api/");

const NO_STORE = { "Cache-Control": "no-store" };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...NO_STORE },
  });
}

/** 401 JSON for API calls; otherwise a redirect to the matching sign-in state page. */
export function unauthenticatedResponse(
  reason: "anonymous" | "expired",
  method: string,
  url: URL,
): Response {
  if (isApiPath(url.pathname)) {
    return json(401, { error: reason === "expired" ? "session_expired" : "unauthenticated" });
  }
  const page = reason === "expired" ? "/session-expired" : "/sign-in";
  // Only a safe GET can be replayed after sign-in; never remember a mutation.
  const location = requiresCsrf(method)
    ? page
    : `${page}?next=${encodeURIComponent(url.pathname + url.search)}`;
  return new Response(null, { status: 303, headers: { Location: location, ...NO_STORE } });
}

/** CSRF or origin check failed. Static body: nothing from the request is echoed back. */
export function forbiddenResponse(url: URL): Response {
  if (isApiPath(url.pathname)) return json(403, { error: "csrf_failed" });
  return new Response(
    standalonePage(
      "Request refused",
      "<p>Your request could not be verified. Go back, reload the page and try again.</p>",
    ),
    { status: 403, headers: { "Content-Type": "text/html; charset=utf-8", ...NO_STORE } },
  );
}

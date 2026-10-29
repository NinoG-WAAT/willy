import type { RateLimitPolicy } from "../../domain/platform/rate-limit";
import type { RateLimiter } from "../../ports/rate-limiter";
import { standalonePage } from "../platform/standalone-page";

export interface RouteLimit {
  name: string;
  policy: RateLimitPolicy;
  /** Owner-scoped when a session exists; webhooks have none and count per client address. */
  scope: "owner" | "client";
}

const MINUTE = 60_000;
const TEN_MINUTES = 10 * MINUTE;

const ID = "[^/]+";
const LIMITS: { method: string; path: RegExp; limit: RouteLimit }[] = [
  {
    method: "POST",
    path: /^\/meetings\/import$/,
    limit: { name: "import", policy: { limit: 20, windowMs: TEN_MINUTES }, scope: "owner" },
  },
  {
    method: "GET",
    path: new RegExp(`^/meetings/${ID}/export\\.md$`),
    limit: { name: "export", policy: { limit: 30, windowMs: TEN_MINUTES }, scope: "owner" },
  },
  {
    method: "POST",
    // Retrying a failed deletion (#19) counts against the same class as requesting one.
    path: new RegExp(`^/(meetings/${ID}/delete|settings/deletions/${ID}/retry)$`),
    limit: { name: "delete", policy: { limit: 30, windowMs: TEN_MINUTES }, scope: "owner" },
  },
  {
    method: "POST",
    path: new RegExp(`^/meetings/${ID}/note/regenerate$`),
    limit: { name: "regenerate", policy: { limit: 30, windowMs: TEN_MINUTES }, scope: "owner" },
  },
  {
    method: "GET",
    path: /^\/search$/,
    limit: { name: "search", policy: { limit: 60, windowMs: MINUTE }, scope: "owner" },
  },
  {
    method: "GET",
    // Job progress polling (#51). Pages back off to one request every 30 s, so 120 a minute only
    // stops a runaway loop; one class covers the meeting and the deletions endpoint.
    path: new RegExp(`^/api/(meetings/${ID}|deletions)/status$`),
    limit: { name: "status", policy: { limit: 120, windowMs: MINUTE }, scope: "owner" },
  },
  {
    method: "POST",
    path: /^\/webhooks\/.*$/,
    limit: { name: "webhook", policy: { limit: 300, windowMs: MINUTE }, scope: "client" },
  },
];

/**
 * Limits for the abuse-prone endpoints that do not enforce their own: import, export, delete,
 * regenerate, search and inbound webhooks. Sign-in and chunk upload have dedicated limits in
 * their use cases. Matching is exact on method and path, so unknown routes are never affected.
 */
export function rateLimitFor(method: string, pathname: string): RouteLimit | null {
  const found = LIMITS.find((l) => l.method === method.toUpperCase() && l.path.test(pathname));
  return found?.limit ?? null;
}

/** Counts one request against its route class; returns null when allowed, else the retry delay. */
export async function enforceRateLimit(
  limiter: RateLimiter,
  request: {
    method: string;
    pathname: string;
    ownerId: string | undefined;
    clientAddress: string;
  },
): Promise<{ limit: string; retryAfterSeconds: number } | null> {
  const route = rateLimitFor(request.method, request.pathname);
  if (!route) return null;
  const who =
    route.scope === "owner" && request.ownerId !== undefined
      ? `owner:${request.ownerId}`
      : `client:${request.clientAddress}`;
  const result = await limiter.consume(`route:${route.name}:${who}`, route.policy);
  return result.allowed ? null : { limit: route.name, retryAfterSeconds: result.retryAfterSeconds };
}

/** 429 with Retry-After: JSON for API paths, a short page otherwise. */
export function rateLimitedResponse(retryAfterSeconds: number, pathname: string): Response {
  const headers = { "Retry-After": String(retryAfterSeconds), "Cache-Control": "no-store" };
  if (pathname.startsWith("/api/") || pathname.startsWith("/webhooks/")) {
    return new Response(JSON.stringify({ error: "rate_limited" }), {
      status: 429,
      headers: { ...headers, "Content-Type": "application/json; charset=utf-8" },
    });
  }
  return new Response(
    standalonePage(
      "Too many requests",
      `<p>Please wait ${String(retryAfterSeconds)} seconds and try again.</p>`,
    ),
    { status: 429, headers: { ...headers, "Content-Type": "text/html; charset=utf-8" } },
  );
}

import type { Logger } from "../../ports/logger";

export interface ObserveDeps {
  logger: Logger;
  /** Milliseconds clock (injected so durations are testable). */
  now: () => number;
  newId: () => string;
}

export interface RequestInfo {
  method: string;
  /** Path only: the query string can carry search terms or tokens and is never logged. */
  pathname: string;
  inboundRequestId: string | null;
  /** Evaluated after the handler ran, when the session has been resolved. */
  ownerId: () => string | undefined;
}

const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;
const MAX_ROUTE_LENGTH = 200;

/** Accepts a well-formed inbound id (a trace can continue across services); else makes one. */
export function resolveRequestId(inbound: string | null, newId: () => string): string {
  return inbound !== null && REQUEST_ID.test(inbound) ? inbound : newId();
}

/** The path as it may appear in logs: capability tokens are replaced, length is bounded. */
export function routeForLog(pathname: string): string {
  const route = pathname.startsWith("/api/files/") ? "/api/files/:token" : pathname;
  return route.slice(0, MAX_ROUTE_LENGTH);
}

function failurePage(requestId: string): Response {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Something went wrong - Willycrumbs</title></head>` +
      `<body><main><h1>Something went wrong</h1><p>Your notes are safe. Try again in a moment. If it keeps happening, quote this reference: <code>${requestId}</code>.</p></main></body></html>`,
    {
      status: 500,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    },
  );
}

/**
 * Wraps one request: assigns a correlation id (`X-Request-Id`, also on every log line through the
 * logger handed to the handler), logs one line with method, route, status, duration and owner id,
 * and turns an unexpected exception into a logged 500 that quotes only the request id. Nothing
 * from the request body, query or the exception message is ever logged.
 */
export async function observeRequest(
  deps: ObserveDeps,
  info: RequestInfo,
  handler: (ctx: { requestId: string; log: Logger }) => Promise<Response>,
): Promise<Response> {
  const requestId = resolveRequestId(info.inboundRequestId, deps.newId);
  const log = deps.logger.child({ requestId });
  const started = deps.now();
  const fields = (status: number) => ({
    method: info.method,
    route: routeForLog(info.pathname),
    status,
    durationMs: deps.now() - started,
    ownerId: info.ownerId(),
  });

  let response: Response;
  try {
    response = await handler({ requestId, log });
  } catch (cause) {
    log.error("request.failed", {
      ...fields(500),
      errorName: cause instanceof Error ? cause.name : "unknown",
    });
    response = failurePage(requestId);
    response.headers.set("X-Request-Id", requestId);
    return response;
  }

  const level =
    response.status >= 500 ? "error" : [401, 403, 429].includes(response.status) ? "warn" : "info";
  log[level]("request.completed", fields(response.status));
  response.headers.set("X-Request-Id", requestId);
  return response;
}

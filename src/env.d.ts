/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    /** Set by the auth middleware on every request that carries a valid session. */
    owner?: { id: string; displayName: string };
    /** Synchronizer CSRF token of the current session; render it in every POST form. */
    csrfToken?: string;
    /** "expired" lets public pages (sign-in, session-expired) explain what happened. */
    sessionState?: "anonymous" | "expired" | "authenticated";
    /** Correlation id of this request (also returned as `X-Request-Id`). */
    requestId?: string;
    /** Logger that adds `requestId` to every line; use it in routes and pass it to use cases. */
    log?: import("./ports/logger").Logger;
  }
}

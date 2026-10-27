import { defineMiddleware } from "astro:middleware";
import { securityHeaders } from "./app/ops/security-headers";

// The strict CSP is production-only: Astro's dev toolbar injects inline scripts.
export const onRequest = defineMiddleware(async (_context, next) => {
  const response = await next();
  if (import.meta.env.PROD) {
    for (const [name, value] of Object.entries(securityHeaders())) {
      response.headers.set(name, value);
    }
  }
  return response;
});

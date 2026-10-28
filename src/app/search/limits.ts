import type { RateLimitPolicy } from "../../domain/platform/rate-limit";

/** Generous for a person typing queries, tight for a script. Counted per owner. */
export const SEARCH_LIMIT: RateLimitPolicy = { limit: 60, windowMs: 60_000 };
export const EXPORT_LIMIT: RateLimitPolicy = { limit: 30, windowMs: 60_000 };

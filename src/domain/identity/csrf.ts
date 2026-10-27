const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Every method that can change state needs a CSRF token; safe methods must never mutate. */
export function requiresCsrf(method: string): boolean {
  return !SAFE_METHODS.has(method.toUpperCase());
}

/** Constant-time comparison; an empty or missing token never matches. */
export function tokensMatch(expected: string, submitted: string | null | undefined): boolean {
  if (expected === "" || !submitted) return false;
  const a = new TextEncoder().encode(expected);
  const b = new TextEncoder().encode(submitted);
  let diff = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

/** The Origin header must equal the app origin exactly; missing or "null" is rejected. */
export function isSameOrigin(origin: string | null, expectedOrigin: string): boolean {
  return origin !== null && origin !== "" && origin !== "null" && origin === expectedOrigin;
}

const MAX_LENGTH = 2000;
const AUTH_PAGES = ["/sign-in", "/signed-out", "/session-expired"];

/**
 * Validates the post-sign-in `next` value: only same-site absolute paths survive, so the sign-in
 * form cannot be turned into an open redirect or a header-injection vector (OWASP A01/A03).
 */
export function safeNextPath(raw: string | null | undefined): string {
  if (!raw || raw.length > MAX_LENGTH) return "/";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/";
  // Backslashes are treated as slashes by browsers; control characters split headers.
  // eslint-disable-next-line no-control-regex -- rejecting control characters is the point
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return "/";
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return "/";
  }
  // eslint-disable-next-line no-control-regex -- see above
  if (/[\\\u0000-\u001f\u007f]/.test(decoded) || decoded.startsWith("//")) return "/";
  const path = raw.split(/[?#]/)[0] ?? "/";
  if (AUTH_PAGES.includes(path)) return "/";
  return raw;
}

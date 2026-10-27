import type { APIRoute } from "astro";
import { clearCookieOptions, SESSION_COOKIE } from "../app/identity/cookies";
import { signOut } from "../app/identity/sign-out";
import { getIdentityDeps } from "../composition";

export const prerender = false;

// Owner route: the middleware has already verified the session, Origin and CSRF token.
export const POST: APIRoute = async ({ cookies }) => {
  await signOut(getIdentityDeps(), cookies.get(SESSION_COOKIE)?.value);
  cookies.set(SESSION_COOKIE, "", clearCookieOptions());
  return new Response(null, {
    status: 303,
    headers: { Location: "/signed-out", "Cache-Control": "no-store" },
  });
};

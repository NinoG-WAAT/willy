# Authentication, sessions, CSRF and authorization

Status: v1 (issue #5). Applies `docs/PLAN.md` sections 3 and 6. Single role: **Owner**.

## How a request is protected

`src/middleware.ts` runs for every request and is **default-deny**: anything not listed as public (`/healthz`, `/sign-in`, `/signed-out`, `/session-expired`, `/_astro/*`, favicon) or signature-authenticated (`/webhooks/*`) requires an Owner session. The list lives in `classifyRoute` (`src/app/identity/route-access.ts`); adding a public route is a deliberate edit there with a test.

- Anonymous page request: `303` to `/sign-in?next=<path>`. Expired session: `303` to `/session-expired?next=<path>`. Both clear the dead cookie. `/api/*` answers `401` JSON (`unauthenticated` or `session_expired`) and never redirects. A mutation never remembers `next`.
- Authenticated: `Astro.locals.owner` (`{id, displayName}`) and `Astro.locals.csrfToken` are set. Owner routes call `requireOwner(Astro.locals)` and pass **that id** to every repository. Never read an owner id from a URL, form or body.
- Another owner's id, a deleted/deleting meeting and an unknown id all return the same `404` (`src/pages/404.astro`, or `new Response(null, {status: 404})` from endpoints). Never `403`. Use the predicates in `src/domain/authz/predicates.ts` as a second check on top of `owner_id = ?` in SQL.

## CSRF

Every non-GET/HEAD/OPTIONS request on an owner route must carry the session's token **and** a same-origin `Origin` header, or the middleware answers `403` before the handler runs.

- Forms: `<input type="hidden" name="csrf_token" value={Astro.locals.csrfToken} />`.
- `fetch` (chunk upload, status): header `X-CSRF-Token: <token>` (render the token into a `data-` attribute, not into inline script).
- The token is a per-session random secret kept server-side (synchronizer token), so it is not guessable and dies with the session.
- Sign-in has no session yet: it uses a double-submit cookie (`__Host-willy_login_csrf`) plus the `Origin` check, and the token is rotated after every attempt.
- Webhooks skip session and CSRF and **must verify their signature** (#7).

## Sessions

- Cookie `__Host-willy_session`: `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, no `Domain`. Loopback counts as secure in browsers, so local development works over http.
- The cookie holds an opaque 256-bit token; the database stores only its SHA-256 (`session.token_hash`). A new session is created on every sign-in and the presented one is revoked (rotation).
- Idle timeout 2 hours (slides on activity, written at most once a minute), absolute timeout 7 days. Sign-out revokes the row.
- Sign-in is rate limited (5 attempts per email and 20 per client address per 15 minutes; `429` with `Retry-After`); a success resets that email's counter. Wrong password and unknown email give the same message and do the same hashing work.
- Passwords: PBKDF2-SHA256 through Web Crypto, 100,000 iterations (the Cloudflare Workers maximum); the count is stored in the hash so it can be raised where the platform allows.

## Development credentials and production

`npm run db:seed` creates `ada@example.test` and `ben@example.test`, both with the development-only password `willy-dev-password` (`seeds/seed.ts`). Owner A and owner B exist to prove isolation. For production the documented option is an emailed magic link behind a mail adapter; it is not built in this slice (`docs/PLAN.md` section 11, question 1). Never seed a production database.

Astro does not trust the `Host` header. Behind a real domain set `WILLY_ALLOWED_HOSTS=app.example.com` **when building**, otherwise Astro derives its origin as `localhost:<port>` and its own cross-site form check rejects real browsers. E2E runs use `http://localhost:4321` for that reason.

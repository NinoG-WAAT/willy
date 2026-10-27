# Willycrumbs

A deliberately narrow alternative to Granola for one audience: a **founder** who wants searchable notes from their **own, consented** meetings. Capture audio with explicit consent, take rough notes, get a transcript-backed, editable summary with decisions and action items, then search, export to Markdown and permanently delete.

Non-goals: secret recording, joining calls as a bot, sales intelligence, inferring employee performance.

Documents: [product.md](product.md) (behavior), [CLAUDE.md](CLAUDE.md) (engineering rules), [docs/PLAN.md](docs/PLAN.md) (technical plan), [docs/DATA_MODEL.md](docs/DATA_MODEL.md) (schema, lifecycle, retention).

## Status

This is built in small PRs. The README describes what exists on `main`; each section marks what is still to come so nothing here is aspirational by accident.

| Area | State |
|---|---|
| App shell, `/healthz`, security headers, single test command | done |
| Database schema, migrations, seeds, envelope encryption | done |
| Calendar import adapter (fake + Google, webhooks, OAuth, encrypted tokens) | done (domain and adapters; screens come later) |
| Sign-in and sessions, meeting lifecycle, STT/LLM/storage adapters, jobs, deletion job | in progress |
| Folders and templates (settings pages: create, edit, default, delete) | done |
| Screen 1: meetings home, new note, calendar import (demo calendar; Google connect flow pending) | done |
| Screens 2-4 (live note, review, search/settings hub), search and export | not started |

## Prerequisites

- Node.js 22 or newer (`node --version`)
- npm (ships with Node)
- For end-to-end tests: Playwright's Chromium (`npx playwright install chromium`)

No cloud account is needed for local development: every external provider has a deterministic fake.

## Local setup

```bash
git clone https://github.com/NinoG-WAAT/willy.git
cd willy
npm ci
cp .env.example .env     # placeholders only; edit as needed
npm run db:migrate       # creates ./data/willy.db and applies migrations/
npm run db:seed          # two demo owners with representative meetings
npm run dev              # http://127.0.0.1:4321 (a built server needs: node --env-file=.env dist/server/entry.mjs)
```

Health check: `curl http://127.0.0.1:4321/healthz` returns `{"status":"ok"}` (status only, no data).

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Astro dev server |
| `npm run build` / `npm run preview` | production build / serve it |
| `npm run lint` | ESLint (including the domain-purity import rules) and Prettier check |
| `npm run typecheck` | `astro check` (TypeScript strict) |
| `npm test` | **The one command**: unit + integration (Vitest) then browser tests (Playwright, desktop and a 390x844 phone viewport) |
| `npm run test:unit` / `npm run test:e2e` | the two halves of `npm test` |
| `npm run db:migrate` / `npm run db:seed` | apply migrations / load seed data |

Tests use isolated data: every Vitest file and every Playwright run gets a fresh temporary directory, and no test touches the network or a real provider.

## Environment variables

All names live in [.env.example](.env.example) with placeholders. Never commit `.env` or real secrets; secrets never use a `PUBLIC_` prefix.

| Variable | Purpose |
|---|---|
| `HOST`, `PORT` | server binding |
| `WILLY_DATA_DIR` | directory for the local SQLite file and fake object storage |
| `ENCRYPTION_KEYS`, `ENCRYPTION_ACTIVE_KEY_ID` | AES-256-GCM keyring (`id:base64(32 bytes)`, comma separated) for transcripts and provider tokens; generate a key with `openssl rand -base64 32`. Keep old ids listed so older records still decrypt after rotation |
| `CALENDAR_PROVIDER` | `fake` (default) or `google` |
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` | Google OAuth client (only when `google`) |
| `GOOGLE_OAUTH_REDIRECT_URIS` | exact-match redirect allowlist, comma separated (https, or http for localhost only) |
| `CALENDAR_WEBHOOK_SECRET` | HMAC secret verifying inbound calendar webhooks |
| `OAUTH_STATE_SECRET` | HMAC secret binding the OAuth `state` to the signed-in owner |
| `FAKE_CALENDAR_DOWN_OWNERS` | fake mode only: owner ids whose demo calendar simulates an outage (tests) |

Speech-to-text, LLM and object-storage variables are added to `.env.example` by their own adapter PRs (#8, #9, #10); until then those providers are not wired.

## Migrations and safe rollback

Migrations are numbered, forward-only SQL files in `migrations/`, applied in order by `npm run db:migrate` (already-applied files are skipped, so it is safe to run repeatedly). Never edit a merged migration; add a new one.

Rollback procedure (details and a per-migration table are in [docs/DATA_MODEL.md](docs/DATA_MODEL.md) section 9):

1. Back up first (see below).
2. Write the inverse as a **new** numbered migration; do not delete the old file.
3. For a bad data migration, restore the backup taken in step 1.

## Seed data

`npm run db:seed` refuses to run on a database that already has owners (delete `data/willy.db` to reseed). It creates two distinct owners so isolation can be demonstrated and tested, plus representative states: a happy-path meeting, a not-started one, failed transcription, an overdue action item, an archived meeting, a meeting in `deleting`, and a meeting owned by the *other* owner that the first owner must never see. Seeds use a fake development key unless `ENCRYPTION_KEYS` is set.

## Integration setup

Each integration is a small adapter behind a port with a deterministic fake; the fake is the default so a fresh checkout runs without secrets. Real providers are selected by environment variables only.

- **Calendar** (done): set `CALENDAR_PROVIDER=google` and the Google variables above. Create an OAuth client in Google Cloud with the read-only scope `calendar.events.readonly`, add each redirect URI to both Google and `GOOGLE_OAUTH_REDIRECT_URIS`. Tokens are encrypted at rest and never logged. Inbound webhooks must be signed: `X-Willy-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">` with `CALENDAR_WEBHOOK_SECRET`, five minute tolerance; deliveries are deduplicated by id.
- **Speech-to-text, LLM, object storage**: to come with #8, #9, #10. Setup notes are added here by those PRs.

All outbound calls go to allowlisted https hosts only, with fixed timeouts, no redirect following and normalized errors.

## Deployment (Cloudflare)

Target runtime: Astro SSR on Cloudflare Workers with D1 (relational data), R2 (private audio and objects), Queues (transcription, summary and deletion jobs) and cron triggers (retention sweeper). Secrets are Worker secrets, never committed. The Cloudflare adapter, `wrangler` configuration and deployment steps are not on `main` yet; the local Node build (`npm run build`, then `node --env-file=.env dist/server/entry.mjs`) is what runs today. This section will be completed when the Cloudflare adapter lands (tracked in [docs/PLAN.md](docs/PLAN.md) section 9).

## Backup and restore

Local SQLite: stop the app (or use the SQLite backup API), then copy the file.

```bash
cp data/willy.db "backups/willy-$(date -u +%Y%m%dT%H%M%SZ).db"    # backup
cp backups/willy-<timestamp>.db data/willy.db                      # restore (app stopped)
```

Cloudflare D1 (once deployed): `wrangler d1 export <database> --output backup.sql` to back up, and `wrangler d1 execute <database> --file backup.sql` into a fresh database to restore. Take a backup before every migration. Backups contain encrypted transcript text, so they are only restorable with the matching `ENCRYPTION_KEYS`: store the keyring securely and separately from the backup. A restore brings back meetings that were permanently deleted after the backup was taken; re-run deletion for those (see below).

## Retention, deletion and external-data cleanup

- Raw audio is deleted after successful transcription by default; only chunks that transcribed successfully are purged, so failures can be retried.
- Permanent deletion is two steps: the meeting is marked `deleting` immediately (hidden everywhere, guessed URLs return 404), then a retryable job removes stored files, derived search index entries and rows. Only a content-free audit record remains. The job is idempotent and safe to retry.
- A scheduled retention job applies the owner's retention settings.

The deletion job and retention settings UI are in progress (#13, #19); the data model for them is in [docs/DATA_MODEL.md](docs/DATA_MODEL.md) section 5.

## Security decisions

- **Consent first**: capture cannot start until the owner ticks an explicit consent statement; the time and statement version are stored. The product never claims consent on behalf of other participants and never records secretly.
- **Draft until published**: generated notes stay drafts until a person publishes them; summary sections keep links to transcript ranges; attendees and decisions are never invented.
- **Owner isolation**: every query carries the owner id from the session; other owners' ids return 404; tests cover cross-owner and guessed-id access. Sessions arrive with #5; the schema and calendar import already scope by owner.
- **Encryption**: transcripts and provider tokens are encrypted at rest (AES-256-GCM envelope encryption, key id stored with each record for rotation, ciphertext bound to its row). Session cookies will be `Secure`, HttpOnly and SameSite once sign-in lands (#5).
- **Injection and output**: parameterized SQL only; output escaped by default; transcript text is untrusted input to the LLM and its output is data, never instructions.
- **Webhooks and OAuth**: constant-time signature checks with timestamp tolerance, event deduplication, owner-bound OAuth state, exact-match redirect allowlist.
- **Headers**: CSP without inline script, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy: microphone=(self)`, `frame-ancestors 'none'`.
- **Logs**: structured, with correlation ids; secrets, tokens, audio, transcript and note text and attendee emails are never logged.
- **Dependencies**: lockfile committed; `npm audit --omit=dev` runs in CI.

Full checklist: CLAUDE.md section 8.

## Known limitations

- Several screens and server features are not on `main` yet (see Status); this README is updated in the same PR as each behavior change.
- No ICS file import yet; calendar import currently supports Google (and the fake).
- Production sign-in is not built in this slice: development uses seeded credentials; an emailed magic link behind a provider adapter is the documented production option.
- Live updates use polling, not server-sent events.
- Diarization depends on the speech-to-text provider; owner corrections are the source of truth.
- Single role (Owner); no sharing or teams by design.

## Contributing

Follow [CLAUDE.md](CLAUDE.md): TDD, Conventional Commits, one issue per PR, squash merge once `ci` is green.

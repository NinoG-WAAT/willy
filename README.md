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
| ICS calendar file import (Outlook / Teams export; no Entra, Google or API keys needed) | done |
| Screen 2: live note (consent, capture, rough notes, recording state, failure recovery) | done |
| Search and Markdown export | done |
| Screen 3: review (transcript beside editable summary, speakers, decisions, action items, publish to folder) | done |
| Screen 4: settings hub (provider status, retention, template/folder/export entry points, permanent deletion with typed confirmation and job status) | done |

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
| `WILLY_CAPTURE_SEGMENT_MS` | length of each uploaded audio chunk (default 10000; tests shorten it) |
| `FAKE_CALENDAR_DOWN_OWNERS` | fake mode only: owner ids whose demo calendar simulates an outage (tests) |
| `STT_PROVIDER` | `fake` (default), `deepgram` (paid cloud) or `whisper` (local and free, see [Using real providers](#using-real-providers)) |
| `STT_API_KEY`, `STT_API_BASE_URL` | Deepgram only |
| `STT_WHISPER_MODEL` | whisper only, required: absolute path of a ggml model file |
| `STT_WHISPER_BIN`, `STT_FFMPEG_BIN`, `STT_WHISPER_LANGUAGE`, `STT_WHISPER_MAX_CONCURRENCY` | whisper only, optional (defaults: `whisper-cli`, `ffmpeg`, `auto`, `1`) |
| `STT_TIMEOUT_MS` | per-request timeout (defaults: 30000 deepgram, 60000 whisper) |
| `LLM_PROVIDER`, `LLM_API_KEY`, `LLM_API_BASE_URL`, `LLM_MODEL`, `LLM_TIMEOUT_MS` | summaries: `fake` (default) or `anthropic` |

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
- **Speech-to-text, LLM**: see [Using real providers](#using-real-providers). Object storage is local disk until #10 lands.

All outbound calls go to allowlisted https hosts only, with fixed timeouts, no redirect following and normalized errors. The one exception to "outbound" is the local Whisper adapter, which makes no network calls at all: it runs two local programs.

## Using real providers

The fake providers are the default and need nothing. Real ones are chosen in `.env` only (never commit `.env`; secrets never get a `PUBLIC_` prefix). Whatever you choose, check it with `GET /diagnostics` while signed in (or the Settings screen): `speechToText` shows `fake`, `deepgram` or `whisper`, and `misconfigured` means a variable is missing or invalid (errors name the variable, never its value; compare your `.env` with the variables above).

**Honest status of the real adapters.** Deepgram and Anthropic were developed against stub servers that imitate their documented responses. They have **not** been run against the real services by this project (that needs paid accounts and keys). The Whisper adapter was tested against stubbed processes and fake `ffmpeg` / `whisper-cli` scripts; see the Whisper section for what a real run still needs to prove.

### Free and private speech-to-text: local Whisper (`STT_PROVIDER=whisper`)

Audio never leaves your machine, nothing is paid, and Claude/Anthropic cannot do this job (their APIs do not accept audio). The server runs two local programs for each 10-second chunk:

1. `ffmpeg` converts what the browser recorded (webm/opus in Chrome and Firefox, mp4/aac in Safari, ogg/opus in Firefox) into 16 kHz mono WAV. This is required: whisper.cpp cannot read webm or mp4 audio.
2. `whisper-cli` (from [whisper.cpp](https://github.com/ggml-org/whisper.cpp)) transcribes the WAV with a model file you download once. Nothing is bundled in this repository.

Install on macOS (Homebrew):

```bash
brew install whisper-cpp ffmpeg        # provides whisper-cli and ffmpeg
which whisper-cli ffmpeg               # both must print a path
mkdir -p ~/whisper-models
curl -L -o ~/whisper-models/ggml-base.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin
```

Model size trade-off (approximate download sizes; the speed column is a rule of thumb from whisper.cpp reports, **not measured by this project**): `ggml-tiny.bin` ~75 MB, fastest, rough accuracy; `ggml-base.bin` ~140 MB, a good first choice; `ggml-small.bin` ~460 MB, noticeably better; `ggml-medium.bin` ~1.5 GB, slow on a laptop. Files ending `.en` are English-only and a little more accurate for English. Each chunk loads the model again, so bigger models add a fixed delay per chunk, and chunks are processed one at a time by default.

`.env` (use absolute paths; `~` is not expanded):

```bash
STT_PROVIDER=whisper
STT_WHISPER_MODEL=/Users/you/whisper-models/ggml-base.bin
# optional: STT_WHISPER_LANGUAGE=en   (default auto-detects per chunk; a fixed language is typically faster and steadier)
# optional: STT_TIMEOUT_MS=60000, STT_WHISPER_MAX_CONCURRENCY=1, STT_WHISPER_BIN=/opt/homebrew/bin/whisper-cli, STT_FFMPEG_BIN=/opt/homebrew/bin/ffmpeg
```

Run it with the `.env` loaded, then confirm:

```bash
npm run build && npm run db:migrate && npm run db:seed
node --env-file=.env dist/server/entry.mjs        # sign in as ada@example.test / willy-dev-password
# GET /diagnostics must show "speechToText":"whisper" (not "misconfigured").
```

Record a short note on the live-note screen (use Chrome or Safari, allow the microphone) and check that the transcript appears. To test the programs without the app, run the manual smoke test with a short recording of your own: `STT_PROVIDER=whisper STT_WHISPER_MODEL=... WHISPER_SMOKE_AUDIO=/path/clip.webm npx vitest run tests/integration/stt/whisper-cpp-smoke`.

Limits and behavior to know:

- **Node only.** Cloudflare Workers cannot start programs, so this adapter is for local development and self-hosted Node. A Workers deployment keeps using a network provider (Deepgram).
- **No speaker labels.** Whisper does not diarize; every segment is "Speaker 1" until the owner corrects speakers on the review screen.
- Silence and noise markers such as `[BLANK_AUDIO]` or `(silence)` are dropped, so a silent chunk gives no segments. Whisper can still invent text on very quiet audio; that is a property of the model.
- Errors: a missing program or model file is `unavailable` (retried with backoff), undecodable audio is `rejected` (not retried), a run that exceeds `STT_TIMEOUT_MS` is `timeout`. Local Whisper is never `rate_limited`.
- Privacy: each chunk is written to a private temp directory (mode 0700) and deleted right after, even on failure; the programs receive a minimal environment (no keys) and their output is discarded; audio and transcript text are never logged.
- Resource use: at most `STT_WHISPER_MAX_CONCURRENCY` (default 1, maximum 4) Whisper runs at once; further chunks wait in line, and waiting does not count against the timeout.

### Deepgram speech-to-text (`STT_PROVIDER=deepgram`)

Paid cloud service: **audio is sent to Deepgram.** Set `STT_PROVIDER=deepgram` and `STT_API_KEY` (server-side secret). The host is fixed to `https://api.deepgram.com` unless you set an https `STT_API_BASE_URL`; the model is `nova-2` with diarization. Untested against the real service (stub server only).

### Anthropic summaries (`LLM_PROVIDER=anthropic`)

Set `LLM_PROVIDER=anthropic` and `LLM_API_KEY`; optionally `LLM_MODEL` (default `claude-sonnet-5-5`) and `LLM_TIMEOUT_MS`. Transcript text is sent to Anthropic to write the draft summary; it is treated as untrusted input and the result stays a draft until you publish it. Untested against the real service (stub server only).

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

Settings (`/settings`) lets the owner choose how long raw audio is kept (default: deleted right after transcription; up to 7 days) and optionally expire old meetings automatically (off by default; turning it on or shortening it needs an explicit tick). Permanent deletion lives at `/meetings/:id/delete`: it states what is destroyed, requires typing `DELETE`, and the settings screen then shows the deletion job (queued, deleting, retrying, failed with a retry button, deleted). The data model for them is in [docs/DATA_MODEL.md](docs/DATA_MODEL.md) section 5.

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

## Importing meetings from Outlook or Teams (ICS file)

If your company runs Microsoft 365 and you cannot register an Entra app, you can still bring meetings in: export them from Outlook as an `.ics` file and upload it. No account, token or network call is involved, the file is parsed in memory and never stored, and nothing is imported until you confirm.

1. Export from Outlook (steps differ a little by version; Teams shows the same Outlook calendar, so Teams meetings are in the export):
   - **Classic Outlook (Windows)**: Calendar, File, Save Calendar. Pick a date range (a few weeks is plenty), detail "Full details", and save the `.ics` file. For one meeting, open it, File, Save As, and choose "iCalendar Format (*.ics)".
   - **Outlook on the web / new Outlook**: Settings, Calendar, Shared calendars, Publish a calendar. Open the ICS link it shows in your browser to download the file. (Willycrumbs never fetches that link itself.)
2. In Willycrumbs, on the Meetings screen choose **Import from ICS file** (`/meetings/import/ics`), upload the file or paste its text, pick the time zone for events that carry none, and choose **Preview events**.
3. Untick anything you do not want, then **Import selected events**. Re-importing the same file, or a newer export, never creates duplicates: an event is identified by its calendar id (UID, plus the replaced time for a changed occurrence of a series) and a changed event updates the existing Meeting's title, time and attendee list. Your notes, consent and capture state are never touched.

What it does and does not do:

- Reads single meetings and `RECURRENCE-ID` overrides (a changed or moved occurrence of a series). A **recurring series** (`RRULE`/`RDATE`) is listed in the preview but **not expanded and not imported**: expanding a rule needs a full recurrence engine, and an unbounded series must never flood the list. Export the date range containing the occurrence you want, or use New note.
- Windows time zone names Outlook writes ("W. Europe Standard Time") are mapped to IANA zones (`src/domain/calendar/windows-timezones.ts`); IANA names work too. An event whose zone cannot be identified is skipped and listed, never guessed. DST gaps and overlaps follow RFC 5545 (see `tests/unit/calendar/local-time.test.ts`).
- Attendees are exactly the `ORGANIZER` and `ATTENDEE` entries in the file (rooms and equipment are left out). Nobody is invented, and listing someone does not record their consent.
- Cancelled events are shown but cannot be selected. Teams join links and any URL in the description or location are shown as plain text and never linked or fetched.
- Limits (reject, never truncate): 1 MB per file, 200 events, 64 KB per unfolded line, UTF-8 only, `.ics` files or pasted text. The two POST routes are rate limited (40 per 10 minutes per owner) and capped at 4 MB of request body before anything is read.

## Design

The visual reference is [`DESIGN.md`](DESIGN.md) (supplied by the owner, kept unchanged): a dark "midnight precision instrument" with void, carbon and obsidian surfaces, one acid-lime primary action, hairline borders, 6 and 12px radii and Inter at weights 400 to 590. Its values live in **one file, `src/styles/tokens.css`**, as CSS custom properties; `src/styles/global.css` imports it with the `base`, `components` and `screens` layers, which read tokens only. `tests/unit/styles/design-tokens.test.ts` fails on a colour literal or hard-coded radius anywhere else and checks the colour, spacing and radius tokens against `DESIGN.md`. Inter variable (latin subset, SIL OFL, `src/styles/fonts/`) is self-hosted; there is no third-party font or CDN request.

Where `DESIGN.md` gives way to our rules: hit areas are at least 44px (the compact paddings stay, the target is enlarged); Ash `#62666d` is never used for text (3.4:1 on Void) and is used only for control borders, which must reach 3:1; status is always words plus a marker, never colour alone, so Pulse Green and Coral Red stay decoration and a destructive edge; hairlines are real 1px borders (not 0.5px or inset shadows) so forced-colors mode draws them; the primary action is `button-primary` (acid lime, one per view) and every other button is ghost; type is in rem and stays on the small steps (the 48 to 72px marketing sizes are defined but unused); inputs are 16px so iOS does not zoom; the focus ring is a 3px Paper outline; the top bar is not sticky (it would obscure focus and the sticky recording banner). The nav shows the text "Willycrumbs", not a logo.

## Accessibility

Every screen is built to WCAG 2.2 AA as far as automation can show: semantic landmarks (one banner, main, contentinfo, a labelled main navigation that marks the current page with `aria-current`, and search forms as `search` landmarks), a skip link, explicit labels, one `h1` and a page title per screen, a visible focus ring everywhere, state that is always also text or shape (never colour alone), controls at least 44px high, `aria-live`/`role="status"` for capture state, upload status, autosave, notices and job results, `role="alert"` for errors, and `prefers-reduced-motion` support (the recording indicator stops pulsing but keeps its label). The phone layout is its own design: a compact header with one navigation row, full-width fields and primary actions, and no horizontal scroll down to 320px.

Checks that run in `npm test`: `tests/e2e/a11y.spec.ts` scans every screen and state with axe-core (WCAG 2 A/AA, 2.1, 2.2 and best-practice rules, nothing disabled) at desktop and 390x844; `tests/e2e/a11y-behaviour.spec.ts` covers keyboard-only journeys, focus rings, motion, reflow and the phone layout. These do not replace a manual screen reader pass: none has been run yet (see Known limitations).

## Known limitations

- **Search does not cover transcripts.** The index holds titles, agendas, rough notes, summary sections, decisions and action items. Transcripts are encrypted at rest and an index would store their text in plaintext; indexing them needs an encrypted-index decision (docs/DATA_MODEL.md section 5). Search hits can still open the review screen at the cited source range.

- Several screens and server features are not on `main` yet (see Status); this README is updated in the same PR as each behavior change.
- ICS import does not expand recurring series and has only been checked against synthetic Outlook-style fixtures, not a real Outlook or Teams export; Google calendar import is not connected end to end yet.
- Production sign-in is not built in this slice: development uses seeded credentials; an emailed magic link behind a provider adapter is the documented production option.
- Live updates use polling, not server-sent events.
- Diarization depends on the speech-to-text provider; owner corrections are the source of truth.
- Single role (Owner); no sharing or teams by design.
- Accessibility is verified with axe-core, Playwright keyboard tests and manual visual review only. It has not been tested with a real screen reader (VoiceOver, NVDA, TalkBack) and live-region announcements are asserted in the DOM, not heard. Job progress (transcription on the live note, review and home; regeneration; deletion on settings) is announced by polling (docs/PLAN.md, decision 5) but, like the rest, has not been heard on a real screen reader; the manual pass, hover and paused-banner contrast and the review layout question are tracked in #51.

## Contributing

Follow [CLAUDE.md](CLAUDE.md): TDD, Conventional Commits, one issue per PR, squash merge once `ci` is green.

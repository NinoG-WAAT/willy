# CLAUDE.md - Willycrumbs engineering rules

Every agent and developer follows this file. If it conflicts with a GitHub issue, this file wins for process; `product.md` wins for product behavior. Change this file only via a PR that says why.

## 1. Project summary

Willycrumbs is a deliberately narrow alternative to Granola: a **founder** captures **consented** meeting audio, takes rough notes, and gets a transcript-backed, editable summary with decisions and action items, then searches, exports to Markdown, and permanently deletes. Full spec: `product.md` (read it before any feature work).

Non-goals (reject any work toward them): secret recording, joining calls as a bot, sales intelligence, inferring employee performance, extra roles, extra surfaces.

Product rules that are invariants (server-enforced, never UI-only):
- Capture cannot start until the owner ticks the explicit consent statement; consent time is stored; we never claim consent on behalf of others.
- Generated content is a **draft** until a person publishes it. Summary sections keep source links to transcript ranges. Never invent attendees or decisions.
- Raw audio is deleted after successful transcription (default). Transcription is idempotent (no duplicate segments). Rough notes survive any failure.
- Every meeting, transcript, folder, export, search hit, and file URL is authorized by owner. Permanent deletion removes files and derived indexes via a retryable job.

## 2. Stack

Node.js 22, Astro SSR (server-rendered pages + plain HTML forms; client JS only for MediaRecorder/audio-level meter, timer, live updates), TypeScript strict. Cloudflare D1 (relational), R2 (private audio/object storage), Workers (endpoints, cron), Queues (transcription, summary, deletion jobs). Durable Objects only if a real-time coordination need is proven. Vitest (unit + integration), Playwright (e2e incl. one small viewport). **One command: `npm test`** runs everything against isolated data. Other required scripts: `lint`, `typecheck`, `build`, `dev`. CI calls exactly these names.

Layout (target, created by #3/#4):
```
src/domain/<context>/   pure TS: entities, value objects, policies, state machines. NO I/O, NO Astro, NO Date.now()/Math.random() (inject Clock/IdGenerator).
src/app/<context>/      use cases: orchestrate domain + ports. Take ports as arguments.
src/ports/              small interfaces: MeetingRepository, ObjectStore, Transcriber, Summarizer, CalendarSource, JobQueue, Clock, Logger
src/adapters/           d1/, r2/, stt/, llm/, calendar/, queue/ - each with a real impl AND a deterministic fake
src/pages/ src/components/   Astro routes + UI: parse request -> call use case -> render. No business rules.
migrations/  seeds/  tests/{unit,integration,e2e}/  docs/
```

## 3. TDD (red-green-refactor, no exceptions for domain/security code)

1. **Red**: write the failing test first, run it, see it fail for the right reason. Commit `test: ...` when practical.
2. **Green**: smallest code to pass. **Refactor** with tests green. Never weaken or delete a test to get green.
3. Bug fix = failing regression test first.

Test pyramid and what goes where:
| Level | Tool | Covers | Rules |
|---|---|---|---|
| Unit (most) | Vitest | state transitions (meeting lifecycle, job states), consent rules, authorization predicates, input normalization, timezone/date handling, summary-to-transcript source link mapping, retry/backoff math | No I/O, no network, fake Clock/IDs. Fast (<1s per file). |
| Integration | Vitest + local D1 (miniflare/wrangler) + fake R2 | repository constraints (FK, unique, check), transactions, migrations up/down, each adapter's success / timeout / retry / rejection, signature verification, idempotent job replay | Fresh DB per test file. Fake provider servers; never real providers or secrets. |
| E2E (few) | Playwright | the 3 journeys in `product.md` + acceptance scenarios 1-3, at least one at a phone viewport (e.g. 390x844), with JS-disabled check for core forms | Seeded isolated DB per run. No sleeps; wait on state. |

Mandatory tests for risky surfaces: every new query/mutation has an **owner-A-cannot-read/modify-owner-B** test and a guessed-ID test; every state transition has allowed and forbidden cases; every adapter has timeout and rejection paths; every job has a replay test (second run is a no-op).
No flaky tests: a flaky test is a bug, fix or delete-and-replace the same day. Coverage is a signal, not a goal; do not write assertion-free tests.

## 4. DDD

Ubiquitous language = `product.md` words, used identically in code, DB, UI, tests: **Meeting, Attendee, TranscriptSegment, Note, ActionItem, Template, Folder, Consent, Capture, Chunk, Draft, Published, Owner**. Do not coin synonyms (no "session", "recording" for Meeting, "task" for ActionItem, "user" for Owner in domain code).

Bounded contexts (modules, not microservices):
- **meetings**: Meeting, Attendee, consent, capture lifecycle (`scheduled -> capturing <-> paused -> captured -> transcribing -> ready`, plus `failed`/`deleting`/`deleted`; exact states in #2/#6).
- **transcription**: Chunk, TranscriptSegment, transcription job (idempotent by chunk key).
- **notes**: Note (draft/published), summary sections with source ranges, Decision, ActionItem, Template, Folder.
- **search**: derived index + Markdown export. Derived data only; rebuildable; deleted with its meeting.
- **identity**: Owner, sessions, CSRF, authorization predicates.
- **platform** (shared kernel, keep tiny): ids, Clock, errors, result type, logging.

Rules:
- `domain/` is pure and import-restricted (lint rule): may not import from `app/`, `adapters/`, `pages/`, `astro`, `@cloudflare/*`. Dependencies point inward only.
- Business rules live in domain functions/aggregates (`startCapture(meeting, consent, now)` returns the new state or a typed error). Routes call use cases; they never contain `if (consent)` logic.
- Contexts talk through use cases/ids, not by reaching into each other's tables. Aggregates reference each other by id.
- Ports are defined by the domain's need (`ObjectStore.put/get/delete`), not by the vendor SDK. Vendors are confined to `adapters/`; vendor types never leak out; adapters normalize errors to `ProviderError {kind: timeout|rejected|rate_limited|unavailable, retryable}`.
- Invariants are enforced in the domain **and** backed by DB constraints (FK, UNIQUE, CHECK) and transactions. Never rely on a counter, disabled button, or client check.
- Store instants as UTC ISO-8601 text/epoch consistently; keep the IANA timezone name next to any local schedule/date.
- Audit history (consent record, state-transition log) is append-only.

## 5. SOLID (applied)

- **S**: one reason to change per module. A route parses+calls+renders; a use case orchestrates; a domain function decides. If a file mixes SQL, HTTP, and rules, split it.
- **O**: add a provider by writing a new adapter for an existing port, not by editing use cases. Add a meeting state by extending the transition table + tests, not by scattering `if status ===`.
- **L**: every fake must behave like the real adapter under the same contract tests (shared contract test suite run against fake and real-with-stubbed-server). A fake that never fails is a bug.
- **I**: ports stay small and role-specific (`Transcriber.transcribe(chunk)` not a `ProviderClient` god-interface). Callers depend only on methods they use.
- **D**: use cases receive ports via arguments/constructor; composition happens in one place (`src/composition.ts`, per-request/Worker env). No `new D1Repo()` inside use cases, no module-level singletons holding secrets.
- Do not build a framework. No abstraction until the second concrete use; no generic `BaseRepository`, no DI container, no event bus. Three similar lines beat a premature interface.

## 6. Git flow

- `main` is always releasable and protected. **Never push to main, never force-push main.** All changes via PR.
- Branch from fresh `main`: `<type>/<issue#>-<kebab-slug>`, types `feat|fix|chore|docs|test|refactor|ci`. e.g. `feat/6-meeting-lifecycle`.
- Conventional Commits: `feat(meetings): block capture without consent`. Types: feat, fix, docs, test, refactor, perf, build, ci, chore. Imperative, <= 72 chars subject, body explains why. Breaking change: `!` + `BREAKING CHANGE:` footer.
- Small PRs: one issue, ideally < 400 changed lines excluding lockfile/generated/seed. If larger, split and say so on the issue.
- PR body: use the template, end with `Closes #N`. PR title is a Conventional Commit (it becomes the squash commit message).
- **Rebase on `main`** (`git fetch origin && git rebase origin/main`), never merge main into your branch. After rebase push with `git push --force-with-lease` to **your own feature branch only**.
- **Squash merge only**; branch is deleted on merge. Linear history on main.
- Never commit secrets, `.env`, real audio, or real transcripts. Only `.env.example` with placeholders.
- Do not touch files owned by another open PR without checking `gh pr list`; shared files (`package.json`, lockfile, `wrangler.toml`, migrations dir) get minimal, additive edits and an immediate rebase.
- Migrations: numbered, forward-only files in `migrations/` plus documented rollback notes. Never edit a merged migration; add a new one. If two PRs add migrations, the later one renumbers on rebase.

## 7. CI and merge rules

`.github/workflows/ci.yml` runs on every PR and on push to main. Jobs: `lint`, `typecheck`, `test` (`npm test`), `build`, `audit` (`npm audit --omit=dev`, warning only), and the aggregate job **`ci`**, the only required status check. Before `package.json` exists the code jobs skip and `ci` passes; from #3 on the scripts `lint`, `typecheck`, `test`, `build` must exist (the scaffold PR must add them).

Branch protection on `main`: require `ci` green, require branch up to date, no force pushes/deletions, squash-merge only, auto-merge enabled, delete head branch on merge, **no required human review**.

Auto-merge rules (agents self-merge):
1. Merge only with `gh pr merge <n> --squash --auto` (or without `--auto` once `ci` is already green).
2. Only when `ci` is green, `mergeStateStatus` is clean/mergeable, and the DoD below is met.
3. Behind or conflicting: `git fetch && git rebase origin/main`, resolve, re-run `npm test` locally, push, wait for CI again. **Never** bypass protection, use `--admin`, disable checks, or merge red.
4. CI red: fix the cause. Do not retry blindly more than once; a flaky failure gets its own issue + fix.
5. After merge, confirm the linked issue closed, remove `in-progress`, delete local branch.

## 8. OWASP Top 10 mapped to Willycrumbs (review checklist for every PR)

- **A01 Broken access control**: single owner role. Every SQL query on meetings/attendees/segments/notes/action items/folders/templates/jobs/search carries `owner_id = ?` from the **session**, never from the request. Use authorization predicates (`canRead(owner, resource)`) in use cases, and return 404 (not 403) for other owners' ids to avoid enumeration. Cover search, export, file/audio URLs, SSE/live updates, and guessed URLs. Short-lived signed R2 URLs minted only after an owner check.
- **A02 Cryptographic failures**: chunks and transcripts encrypted at rest (envelope encryption, key from env/secret binding, key id stored per record for rotation). Long-lived provider/OAuth tokens encrypted at rest. TLS only; cookies `Secure`.
- **A03 Injection**: parameterized D1 statements only (`prepare().bind()`), no string-built SQL. Escape all output (Astro default; never `set:html` on user/LLM/transcript text). Markdown export escapes/neutralizes content; any accepted markup goes through an allowlist sanitizer. Treat transcript text as **untrusted input to the LLM** (prompt injection): LLM output is data, never executed, never used to choose tools, URLs, or authorization.
- **A04 Insecure design**: consent, draft-until-published, delete-after-transcribe are server invariants with tests (see section 1). Threat-model new surfaces in the PR.
- **A05 Misconfiguration**: security headers (CSP without inline script, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy: microphone=(self)`, frame-ancestors none); private R2 buckets; no debug/diagnostic endpoints exposing data (health check returns status only).
- **A06 Vulnerable components**: `npm audit --omit=dev` in CI; commit the lockfile; add dependencies sparingly and say why in the PR.
- **A07 Authentication failures**: secure session defaults (HttpOnly, Secure, SameSite=Lax/Strict, rotation on login, idle + absolute expiry), clear signed-out / expired / forbidden pages, rate-limit login. **CSRF**: every state-changing request is POST/PUT/DELETE with a CSRF token (or double-submit + Origin check); never mutate on GET.
- **A08 Integrity failures**: verify inbound webhook signatures (constant-time compare, timestamp tolerance) and dedupe provider events by event id; no unsigned job payloads trusted from clients; pin CI actions to major versions.
- **A09 Logging/monitoring**: structured JSON logs with correlation id (request/job/event id). **Redact** secrets, tokens, audio, transcript/note text, attendee emails (log ids and sizes instead). Failures must be actionable (what failed, which job, retry state). Never `console.log` request bodies.
- **A10 SSRF**: outbound calls only to configured provider hosts (allowlist), https only, fixed timeouts, no following redirects to other hosts, never fetch a URL taken from user/calendar/transcript content. Calendar import accepts provider payloads or ICS text/files, not arbitrary URLs.
- **Uploads**: chunk endpoint enforces max bytes per chunk, max chunks/duration per meeting, content-type allowlist (audio), sequence number + idempotency key, owner + meeting-state check (only `capturing`/`paused`), rate limit. Reject, don't truncate.
- **Rate limits**: login, chunk upload, import, export, search, webhook endpoints. Return 429 with `Retry-After`.
- **Input validation**: validate, normalize (trim, NFC, collapse whitespace where appropriate), and length-limit every field **on the server** with a schema (zod or equivalent) at the route boundary; domain receives typed values. Unknown fields rejected.
- **Secrets**: only in Worker secrets / `.env` (gitignored); `.env.example` lists names with placeholders; never in client bundles (no `PUBLIC_` prefix for secrets).
- **Privacy**: collect minimum personal data; document retention and permanent deletion (files + derived indexes + search rows) in README.

## 9. Engineering conventions

- TypeScript strict, no `any` without a comment, no non-null `!` on external data. Result/typed errors for expected failures; throw only for bugs.
- Idempotency: every repeatable side effect (chunk upload, transcription, summary job, calendar import, webhook, deletion) has an idempotency key + unique constraint and a replay test. Jobs expose `pending | running | succeeded | failed | retrying` with attempt count and next-retry time; retries use capped exponential backoff with jitter; never swallow errors.
- Progressive enhancement: pages work as plain server-rendered forms; JS enhances. Each screen defines primary/secondary actions, status, validation, empty, pending, success, recoverable-failure states (see `product.md`). Accessibility: labels, landmarks, focus visible, keyboard, no color-only state, reduced motion, `aria-live` for async results. Destructive actions state scope and require confirmation.
- Seed data (`seeds/`) must include two distinct owners (to demo/test isolation), plus empty, failed, overdue/expired, and deleting states.
- Keep comments for *why*. No dead code, no TODO without an issue number.
- Docs live with code: update README/`docs/` (technical plan #2, data model #4) in the same PR as the behavior change.

## 10. Definition of done (all must be true before merge)

- [ ] Tests written first; red-green-refactor followed; `npm test` green locally and `ci` green.
- [ ] `lint` and `typecheck` clean; `build` passes; no new `npm audit` highs without a note.
- [ ] Domain rules in pure modules; no I/O in `domain/`; SOLID/ports-adapters respected; ubiquitous language used.
- [ ] Authorization enforced server-side and tested with a cross-owner and guessed-ID test (if data is touched).
- [ ] OWASP checklist in section 8 walked through; PR template checked honestly.
- [ ] Docs, `.env.example`, seeds, migrations (with rollback note) updated if affected.
- [ ] UI work: all states present, keyboard/screen-reader/mobile checked, works without JS for the core path.
- [ ] PR is small, single-issue, Conventional Commit title, body ends with `Closes #N`.

## 11. Agent working agreement (two parallel senior dev agents + guidelines)

Lanes are GitHub labels: `lane:dev-a`, `lane:dev-b`, `lane:guidelines` (one-off, #1). Plan: dev-a owns the backbone (scaffold #3, schema #4, auth #5, lifecycle #6, STT/LLM/storage adapters #8-#10, jobs #11-#13, ops #20); dev-b owns calendar adapter #7, technical plan #2, screens #14-#19, a11y #21, e2e #22, docs #23.

**Claim protocol (follow in order, every time):**
1. List work: `gh issue list --repo NinoG-WAAT/willy --state open --label "lane:<yours>" --json number,title,labels,body`. Pick the lowest-numbered issue in **your own lane** that is unclaimed (no `in-progress` label, no open PR referencing it).
2. **Skip if blocked**: parse the `**Blocked by:**` line; if any listed issue is still open (check `gh issue view N --json state`), skip it. Do not start work on stubs of unmerged dependencies.
3. If your lane has nothing unblocked, you may take an unclaimed unblocked issue from the other lane (own lane first, always). Never take an issue labelled `in-progress`.
4. **Claim before starting**: `gh issue edit N --add-label in-progress` then `gh issue comment N --body "Claimed by <agent> (lane:<x>). Branch: <type>/N-slug."`. Re-read the issue labels right after; if the other agent claimed within the same minute, the **lower lane letter (dev-a) keeps it**, the other releases.
5. Work on branch `<type>/N-slug` from fresh `main`, TDD, small commits. Open the PR early with `Closes #N`.
6. Merge with `gh pr merge --squash --auto` only if `ci` is green and the PR is mergeable. On conflict/behind: rebase, re-test, push (`--force-with-lease`, own branch), wait for CI. **Never force-merge**, never use `--admin`, never push main.
7. If you become blocked or abandon: remove `in-progress`, comment why and what you learned. Do not leave stale claims (> 1 working session without a PR or comment).
8. After merge: verify the issue closed, remove `in-progress` if still present, then pick the next issue. If you discover missing work, open a new issue (with lane label and `Blocked by`), do not silently expand scope.

Coordination:
- Shared contracts (ports in `src/ports/`, DB schema, route/endpoint list in the technical plan) change by small PR first, then dependants rebase. Announce on the affected issue.
- If you need something from the other lane that is not merged, comment on that issue; do not duplicate it.
- Ask a human (comment on the issue, label `question`) when `product.md` is ambiguous in a way that changes data or security behavior; otherwise resolve toward the narrow audience and non-goals and note the decision in the PR.
- Report honestly: say precisely what was run and what is unverified. Never claim a green run you did not see.

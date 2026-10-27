## What and why

<!-- One or two sentences. Link the issue. -->

Closes #

## Tests (TDD)

- [ ] Failing test(s) written first (commit history shows `test:` before `feat:`/`fix:` where practical)
- [ ] Right level: domain unit / adapter or DB integration / browser e2e (see CLAUDE.md pyramid)
- [ ] `npm test` passes locally, with isolated data and no network

## Security and privacy (OWASP)

- [ ] Every new query/mutation/endpoint scopes by `owner_id` server-side (guessed-ID test included)
- [ ] State-changing routes are POST with CSRF protection; untrusted input validated, normalized, length-limited
- [ ] No secrets, transcript text, or audio in logs; no new secrets committed (`.env.example` updated if needed)
- [ ] Outbound calls and uploads: timeouts, allowlisted hosts, size/type limits (or N/A)
- [ ] Consent and deletion rules from `product.md` still hold (or N/A)

## Design

- [ ] Domain rules live in I/O-free modules; routes/components only orchestrate
- [ ] Follows SOLID and ports/adapters rules in CLAUDE.md; no speculative abstraction

## Docs and UX

- [ ] Docs updated (README / data-model / technical plan / `.env.example`) or N/A
- [ ] UI changes: keyboard, focus, labels, works without client JS, small-screen checked (or N/A)

## Merge

- [ ] `ci` is green and branch is rebased on `main`
- [ ] Scope is one issue; no unrelated changes

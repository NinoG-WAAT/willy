You are building a production-ready software product named “Willycrumbs”, a deliberately focused alternative to Granola. Build a complete, usable vertical slice—not a landing page, static mockup, or disconnected collection of components.

WORKING AGREEMENT

Before writing implementation code, produce a short technical plan that names the routes or pages, server actions or endpoints, data tables, important state transitions, authorization boundaries, background jobs, and external adapters. Resolve contradictions in favor of the narrow audience and non-goals below. Prefer a small, legible architecture over speculative abstraction, but do not omit persistence, validation, error handling, or tests.

PRODUCT BRIEF

Primary user: a founder who wants searchable notes from their own meetings.

Primary outcome: capture consented meeting context and turn it into editable notes, decisions, and follow-ups.

Product principle: optimize the exact workflow below instead of copying the full breadth of Granola. A first-time user should understand what to do from the interface itself, without a tour or documentation.

END-TO-END USER JOURNEYS

Implement all of these flows through the real interface and persistent data layer:

1. The owner imports a calendar event, confirms every participant has consented, starts capture, takes rough notes, and sees an unmistakable recording state until they stop.

2. After the meeting, the owner reviews the transcript-backed summary, corrects speakers, edits decisions and action items, and publishes the final note to a private folder.

3. The owner searches past notes, opens a result with highlighted source context, exports it to Markdown, and permanently deletes an old meeting with its transcript and audio artifacts.

SCREENS AND INFORMATION ARCHITECTURE

Build these as coherent responsive views. Each screen must specify its primary action, secondary actions, visible status, validation feedback, empty state, loading or pending state, success confirmation, and recoverable failure state.

1. Upcoming and recent meetings: calendar context, consent readiness, note status, private folders, search, and a clear new-note action.

2. Live note: attendees, agenda, editable rough notes, capture timer, input level, consent confirmation, pause and stop controls, and capture failure recovery.

3. Review: transcript beside editable summary sections, speaker corrections, decisions, action-item owner and due date, regenerate-selection action, and publish state.

4. Search and settings: query results with snippets, template editor, provider status, retention controls, export, and permanent deletion.

CORE CAPABILITIES

1. meeting note with agenda, attendees, and live rough notes

2. consent-first audio capture with visible recording state

3. transcript-backed summary, decisions, and action items

4. editable templates for recurring meeting types

5. search across notes and export to Markdown

DETAILED BEHAVIOR AND BUSINESS RULES

Treat these as server-enforced product requirements, not interface suggestions:

1. Capture cannot start until the owner checks an explicit consent statement; keep the recording indicator visible and record consent time without claiming consent from others automatically.

2. Upload bounded encrypted audio chunks, transcribe idempotently, delete raw audio after successful transcription by default, and surface partial failures without losing rough notes.

3. Generated content remains a draft until a person publishes it; preserve source links from summary sections to transcript ranges and never invent absent attendees or decisions.

4. Authorize every meeting, transcript, folder, export, and search result by owner; permanent deletion removes stored files and derived indexes through a retryable deletion job.

DATA MODEL AND LIFECYCLE

Design a small relational schema centered on Meeting, Attendee, TranscriptSegment, Note, ActionItem. Before implementing it, document:

1. Each table’s purpose, primary key, ownership or tenant boundary, timestamps, status fields, and important attributes.

2. Foreign keys, uniqueness constraints, check constraints, indexes needed by the named screens, and transaction boundaries for multi-record changes.

3. The allowed lifecycle or state transitions, who may trigger each transition, which transitions are terminal or reversible, and what audit history must remain immutable.

4. Archive, retention, and deletion behavior, including what happens to dependent records and external files.

5. Idempotency strategy for submissions, jobs, imports, notifications, webhooks, or retries where applicable.

Use migrations rather than ad-hoc schema creation. Store time instants consistently and retain named timezone context whenever local schedules or dates matter. Never rely on a counter, disabled button, or client-side check to preserve a business invariant.

USERS, AUTHENTICATION, AND PERMISSIONS

Implement only the roles required by the stated audience. Make the ownership and visibility model explicit before coding. Enforce authorization in every server-side query and mutation, including search, exports, attachments, live updates, and guessed URLs—not merely by hiding controls. Use secure session defaults, protect state-changing requests, and provide an understandable signed-out, expired-session, and forbidden state. Seed distinct users when multiple roles are required so permissions can be demonstrated and tested.

INTERACTION AND VISUAL DIRECTION

The product should feel fast, calm, focused, and credible rather than like a generic admin template. Use a clear visual hierarchy, restrained color, readable typography, generous hit targets, and consistent placement for primary actions. Start with server-rendered HTML and progressively enhance only the interactions that benefit from it. The core workflow must remain understandable if enhancement fails.

Start with server-rendered Astro pages and ordinary HTML forms on Node.js. Add client JavaScript only for interactions that need browser state, browser APIs, drag-and-drop, or live updates. The core workflow must remain understandable if client JavaScript fails.

Design mobile layouts intentionally instead of simply stacking desktop panels. Support keyboard navigation, visible focus, semantic landmarks, explicit labels, useful page titles, reduced-motion preferences, and screen-reader announcements for asynchronous results. Never use color alone to communicate state. Destructive actions require clear scope and confirmation; safe repeated actions should be idempotent.

TECHNICAL DIRECTION

Build this version with Node.js and Astro. Use Astro for routing, layouts, and server-rendered pages. Start with ordinary HTML forms. Add client JavaScript only when the interface needs it. Prefer Cloudflare D1 for relational persistence, R2 for object storage, Workers for server endpoints and scheduled work, Durable Objects only for coordinated real-time state, and Workflows or Queues for durable background jobs—but only when the product requirements call for them.

Keep domain rules in testable server-side modules instead of route handlers or UI components. Separate persistence, external providers, and background work behind small interfaces without building a framework. Prefer ordinary HTML forms and URLs for durable navigation; use optimistic interaction only when failure can be reconciled clearly.

The product brief currently identifies Astro, Workers, D1, R2 as capability context. Preserve any required native, browser-only, edge, storage, real-time, or background-processing capability through a narrow adapter appropriate to the selected framework. If the core workflow genuinely requires native or browser APIs, keep that runtime as the primary execution surface rather than simulating inaccessible capabilities or inventing an unnecessary web surface.

Integrate with calendar event import and speech-to-text API and LLM API. For every integration:

- List required environment variables in an .env.example without real secrets.

- Add a small adapter with timeouts, normalized errors, and a deterministic local fake or development path.

- Verify inbound signatures and deduplicate provider events where supported.

- Keep credentials server-side, encrypt long-lived provider tokens at rest, and redact secrets and sensitive payloads from logs.

- Define retry, backoff, and idempotency behavior for any side effect that can be repeated.

SECURITY AND PRIVACY

Require explicit recording consent, show capture state continuously, encrypt stored transcripts, and support permanent deletion.

Validate, normalize, and length-limit all untrusted input on the server. Escape rendered content by default, sanitize any intentionally accepted markup, rate-limit public or abuse-prone actions, and use private object storage plus short-lived authorized URLs for sensitive files. Collect the minimum personal data necessary for the named workflow. Document retention and deletion behavior. Add specific protections for the riskier surfaces in this app, such as uploads, redirects, outbound requests, email delivery, OAuth, webhooks, CSV import or export, and real-time connections.

ACCEPTANCE SCENARIOS

Automate these app-specific scenarios at the most appropriate level:

1. Given consent is not confirmed, capture stays disabled; after confirmation, capture starts with a persistent visible state and stopping queues exactly one transcription job.

2. Given transcription fails after some chunks, the rough note survives, retry resumes idempotently, and duplicate transcript segments are not created.

3. Given a deleted meeting, its note, transcript, search hits, and stored audio are unavailable to the owner and to guessed authorized URLs.

TESTING

Add focused unit tests for state transitions, authorization predicates, normalization, date or money calculations, and other risky domain rules. Add integration tests for persistence constraints and each external adapter’s success, timeout, retry, and rejection paths. Add at least one browser-level test for every end-to-end journey above, including one small-screen viewport. Tests must use isolated data and run through a documented single command.

OPERATIONS AND FAILURE RECOVERY

Add structured server logs with request, job, or event correlation IDs but no secrets or unnecessarily sensitive data. Make failures actionable in both the interface and logs. Background work must expose pending, succeeded, failed, and retrying states where relevant; do not silently swallow errors. Include safe database migration and rollback guidance, seed data, backup and restore notes, external-data cleanup behavior, and a basic health or diagnostic path appropriate to the stack.

DELIVERABLES

Ship the working application, migrations, representative seed data, tests, .env.example, and a concise README. The README must cover prerequisites, local setup, environment variables, migrations, seed and test commands, deployment, integration setup, backup and restore, security decisions, and known limitations. Seed data should exercise the happy path plus at least one empty, failed, overdue, expired, archived, or permission-restricted state relevant to the product.

DEFINITION OF DONE

The app is complete when a fresh developer can follow the README, create and migrate the database, run the app, sign in as each relevant role, complete every named journey using real persisted data, refresh without losing state, recover from common failures, and use the core interface on phone and desktop. All acceptance scenarios pass, permission boundaries are covered by tests, and no core screen is left as a placeholder.

NON-GOALS

Do not record secretly, join calls as a bot, build sales intelligence, or infer employee performance.
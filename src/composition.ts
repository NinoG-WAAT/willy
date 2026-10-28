import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { createChunkCipher } from "./adapters/crypto/chunk-cipher";
import { DEV_FILE_URL_SECRET, DEV_KEYRING } from "./adapters/crypto/dev-keyring";
import { createEnvelopeCipher, parseKeyring } from "./adapters/crypto/envelope-cipher";
import { createJsonLogger } from "./adapters/logging/json-logger";
import { createFileTokenService, type FileTokenService } from "./adapters/crypto/file-tokens";
import { createLocalObjectStore } from "./adapters/fs/local-object-store";
import { createFixtureCalendarSource } from "./adapters/calendar/fixture-calendar-source";
import { createPbkdf2Hasher } from "./adapters/crypto/pbkdf2-password-hasher";
import { sha256Hex } from "./adapters/crypto/sha256";
import { readLlmConfig } from "./adapters/llm/config";
import { createSummarizer } from "./adapters/llm";
import { createRetryingSummarizer } from "./adapters/llm/retrying-summarizer";
import { createTranscriber } from "./adapters/stt";
import { readSttConfig } from "./adapters/stt/config";
import { createRetryingTranscriber } from "./adapters/stt/retrying-transcriber";
import { InMemoryRateLimiter } from "./adapters/memory/in-memory-rate-limiter";
import { openDatabase } from "./adapters/sqlite/database";
import { runMigrations } from "./adapters/sqlite/migrate";
import { SqliteChunkRepository } from "./adapters/sqlite/chunk-repository";
import { SqliteJobRepository } from "./adapters/sqlite/job-repository";
import { SqliteMeetingCatalog } from "./adapters/sqlite/meeting-catalog";
import { SqliteNoteReader } from "./adapters/sqlite/note-reader";
import { SqliteSearchIndex } from "./adapters/sqlite/search-index";
import { SqliteNoteRepository } from "./adapters/sqlite/note-repository";
import { SqliteMeetingRepository } from "./adapters/sqlite/meeting-repository";
import { SqliteFolderRepository } from "./adapters/sqlite/folder-repository";
import { SqliteSettingsRepository } from "./adapters/sqlite/settings-repository";
import { SqliteOwnerRepository } from "./adapters/sqlite/owner-repository";
import { SqliteSessionRepository } from "./adapters/sqlite/session-repository";
import { SqliteTemplateRepository } from "./adapters/sqlite/template-repository";
import { RandomIds, SystemClock } from "./adapters/system/system";
import type { IdentityDeps } from "./app/identity/deps";
import { createChunkStore, type ChunkStore } from "./app/storage/chunk-store";
import { SqliteDiagnosticsRepository } from "./adapters/sqlite/diagnostics-repository";
import { SqliteDeletionStatusQuery } from "./adapters/sqlite/deletion-status-query";
import { SqliteProviderIssueQuery } from "./adapters/sqlite/provider-issue-query";
import type { DeletionDeps } from "./app/settings/deletion";
import type { ProviderStatusDeps } from "./app/settings/provider-status";
import type { RetentionDeps } from "./app/settings/retention";
import { readCalendarConfig } from "./adapters/calendar/config";
import type { DiagnosticsDeps } from "./app/ops/diagnostics";
import type { ObserveDeps } from "./app/ops/request-observer";
import { requestMeetingDeletion } from "./app/meetings/delete";
import { deleteJobHandler } from "./app/meetings/delete-job";
import { runDueJobs, type JobHandler, type RunnerDeps } from "./app/jobs/runner";
import type { RegenerateDeps } from "./app/notes/regenerate-section";
import type { ReviewFormDeps } from "./app/notes/review-http";
import { SqliteReviewRepository } from "./adapters/sqlite/review-repository";
import { summaryJobHandler } from "./app/notes/summary-job";
import type { StatusDeps } from "./app/transcription/processing-status";
import { retentionJobHandler, scheduleRetentionJobs } from "./app/transcription/retention";
import { transcribeJobHandler, type TranscribeDeps } from "./app/transcription/transcribe-job";
import type { UploadDeps } from "./app/transcription/upload-chunk";
import type { ImportDeps } from "./app/calendar/import-events";
import type { MeetingDeps } from "./app/meetings/capture";
import type { CreateMeetingDeps } from "./app/meetings/create-meeting";
import type { HomeDeps } from "./app/meetings/home";
import type { LiveNoteDeps } from "./app/meetings/live-note";
import type { ExportDeps } from "./app/search/export";
import type { SearchDeps } from "./app/search/search";
import { providerError } from "./domain/platform/provider-error";
import { err } from "./domain/platform/result";
import type { CalendarSource } from "./ports/calendar-source";
import type { NotesDeps } from "./app/notes/deps";
import { DEFAULT_SIGN_IN_LIMITS, type SignInLimits } from "./app/identity/sign-in";
import type { JobRepository } from "./ports/job-repository";
import type { Logger } from "./ports/logger";
import type { Summarizer } from "./ports/summarizer";
import type { TextCipher } from "./ports/text-cipher";
import type { Transcriber } from "./ports/transcriber";

/**
 * The only place adapters are wired (CLAUDE.md section 5, D). This Node/SQLite composition is for
 * local development, CI and single-server deployments; the Cloudflare composition (D1, R2,
 * Queues) will provide the same ports from Worker bindings. Process-wide state below holds no
 * secrets: a database handle and the in-memory rate-limit counters.
 */

let database: DatabaseSync | undefined;
let identity: IdentityDeps | undefined;
let notes: NotesDeps | undefined;

export function getDatabase(): DatabaseSync {
  if (!database) {
    const dir = process.env["WILLY_DATA_DIR"] ?? "./data";
    mkdirSync(dir, { recursive: true });
    const db = openDatabase(join(dir, "willy.db"));
    // Idempotent and forward-only: an up-to-date database applies nothing.
    runMigrations(db, join(process.cwd(), "migrations"));
    // The search index is derived data: bring it up to date for meetings that predate indexing.
    new SqliteSearchIndex(db).rebuildMissingMeetingRows();
    database = db;
  }
  return database;
}

export function getIdentityDeps(): IdentityDeps {
  if (!identity) {
    const clock = new SystemClock();
    const random = new RandomIds();
    identity = {
      owners: new SqliteOwnerRepository(getDatabase()),
      sessions: new SqliteSessionRepository(getDatabase()),
      hasher: createPbkdf2Hasher(),
      limiter: new InMemoryRateLimiter(clock),
      clock,
      ids: random,
      tokens: random,
      hashToken: sha256Hex,
    };
  }
  return identity;
}

export function getNotesDeps(): NotesDeps {
  if (!notes) {
    notes = {
      folders: new SqliteFolderRepository(getDatabase()),
      templates: new SqliteTemplateRepository(getDatabase()),
      clock: new SystemClock(),
      ids: new RandomIds(),
    };
  }
  return notes;
}

/** Defaults are production-safe; SIGN_IN_CLIENT_LIMIT exists so end-to-end runs from one address work. */
export function getSignInLimits(): SignInLimits {
  const override = Number(process.env["SIGN_IN_CLIENT_LIMIT"]);
  if (Number.isInteger(override) && override > 0) {
    return {
      ...DEFAULT_SIGN_IN_LIMITS,
      perClient: { ...DEFAULT_SIGN_IN_LIMITS.perClient, limit: override },
    };
  }
  return DEFAULT_SIGN_IN_LIMITS;
}

let meetings: MeetingDeps | undefined;

export function getMeetingDeps(): MeetingDeps {
  if (!meetings) {
    const clock = new SystemClock();
    meetings = {
      meetings: new SqliteMeetingRepository(getDatabase(), new RandomIds(), clock),
      clock,
    };
  }
  return meetings;
}

let transcriber: Transcriber | undefined;

/**
 * Speech-to-text with retries. The fake is the default; STT_PROVIDER=deepgram needs STT_API_KEY.
 * A bad configuration fails fast here, naming variables but never their values.
 */
export function getTranscriber(): Transcriber {
  if (!transcriber) {
    const config = readSttConfig(process.env);
    if (!config.ok) throw new Error(`Invalid speech-to-text configuration: ${config.error}`);
    transcriber = createRetryingTranscriber(createTranscriber(config.value, fetch), {
      policy: { maxAttempts: 4, baseMs: 500, capMs: 8000 },
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      random: Math.random,
    });
  }
  return transcriber;
}

let summarizer: Summarizer | undefined;

/**
 * LLM summaries with retries. The fake is the default; LLM_PROVIDER=anthropic needs LLM_API_KEY.
 * A bad configuration fails fast here, naming variables but never their values.
 */
export function getSummarizer(): Summarizer {
  if (!summarizer) {
    const config = readLlmConfig(process.env);
    if (!config.ok) throw new Error(`Invalid LLM configuration: ${config.error}`);
    summarizer = createRetryingSummarizer(createSummarizer(config.value, fetch), {
      policy: { maxAttempts: 3, baseMs: 1000, capMs: 10_000 },
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      random: Math.random,
    });
  }
  return summarizer;
}

let chunks: ChunkStore | undefined;
let fileTokens: FileTokenService | undefined;

/** Fake development secrets are only acceptable outside production. */
function developmentFallbackAllowed(): boolean {
  return process.env["NODE_ENV"] !== "production";
}

/** ENCRYPTION_KEYS / ENCRYPTION_ACTIVE_KEY_ID; a fake dev key is allowed outside production only. */
function getKeyring(): { spec: string; activeKeyId: string } {
  const spec = process.env["ENCRYPTION_KEYS"];
  const activeKeyId = process.env["ENCRYPTION_ACTIVE_KEY_ID"];
  if (spec && activeKeyId) return { spec, activeKeyId };
  if (developmentFallbackAllowed()) return DEV_KEYRING;
  throw new Error("ENCRYPTION_KEYS and ENCRYPTION_ACTIVE_KEY_ID must be set in production");
}

/**
 * Encrypted audio chunk storage on the local disk (`<WILLY_DATA_DIR>/objects`). The Cloudflare
 * composition wires `createR2ObjectStore` with the R2 binding instead.
 */
export function getChunkStore(): ChunkStore {
  if (!chunks) {
    const keyring = getKeyring();
    const dir = join(process.env["WILLY_DATA_DIR"] ?? "./data", "objects");
    chunks = createChunkStore({
      objects: createLocalObjectStore(dir),
      cipher: createChunkCipher(parseKeyring(keyring.spec), keyring.activeKeyId),
    });
  }
  return chunks;
}

let textCipher: TextCipher | undefined;

/** Envelope cipher for transcript text (and provider tokens), same keys as the chunk cipher. */
export function getTextCipher(): TextCipher {
  if (!textCipher) {
    const keyring = getKeyring();
    textCipher = createEnvelopeCipher(parseKeyring(keyring.spec), keyring.activeKeyId);
  }
  return textCipher;
}

/** Signs short-lived file URLs (`/api/files/:token`); FILE_URL_SECRET must be 32+ characters. */
export function getFileTokens(): FileTokenService {
  if (!fileTokens) {
    const secret = process.env["FILE_URL_SECRET"];
    if (!secret && !developmentFallbackAllowed()) {
      throw new Error("FILE_URL_SECRET must be set in production");
    }
    fileTokens = createFileTokenService({
      secret: secret ?? DEV_FILE_URL_SECRET,
      clock: new SystemClock(),
    });
  }
  return fileTokens;
}

let upload: UploadDeps | undefined;

export function getUploadDeps(): UploadDeps {
  if (!upload) {
    const { meetings, clock } = getMeetingDeps();
    upload = {
      meetings,
      chunks: new SqliteChunkRepository(getDatabase()),
      chunkStore: getChunkStore(),
      ids: new RandomIds(),
      limiter: getIdentityDeps().limiter,
      clock,
    };
  }
  return upload;
}

let logger: Logger | undefined;

/** Structured JSON lines on stdout. Fields are redacted by name. */
export function getLogger(): Logger {
  if (!logger) {
    logger = createJsonLogger(
      (line) => {
        process.stdout.write(`${line}\n`);
      },
      () => new Date(),
      { service: "willycrumbs" },
    );
  }
  return logger;
}

let jobRepository: JobRepository | undefined;

function getJobRepository(): JobRepository {
  jobRepository ??= new SqliteJobRepository(getDatabase(), new RandomIds());
  return jobRepository;
}

let transcribeDeps: TranscribeDeps | undefined;

function getTranscribeDeps(): TranscribeDeps {
  if (!transcribeDeps) {
    const { meetings, clock } = getMeetingDeps();
    transcribeDeps = {
      meetings,
      chunks: new SqliteChunkRepository(getDatabase()),
      chunkStore: getChunkStore(),
      transcriber: getTranscriber(),
      textCipher: getTextCipher(),
      settings: new SqliteSettingsRepository(getDatabase()),
      jobs: getJobRepository(),
      ids: new RandomIds(),
      clock,
      logger: getLogger(),
    };
  }
  return transcribeDeps;
}

const JOB_LEASE_MS = 5 * 60_000;

function getRunnerDeps(): RunnerDeps {
  return {
    jobs: getJobRepository(),
    clock: new SystemClock(),
    logger: getLogger(),
    random: Math.random,
    leaseMs: JOB_LEASE_MS,
  };
}

/** Job kinds with a handler: transcribe, summarize, retention and delete. */
function getJobHandlers(): JobHandler[] {
  const deps = getTranscribeDeps();
  return [
    transcribeJobHandler(deps),
    summaryJobHandler({
      meetings: deps.meetings,
      notes: new SqliteNoteRepository(getDatabase(), new RandomIds()),
      templates: new SqliteTemplateRepository(getDatabase()),
      summarizer: getSummarizer(),
      textCipher: deps.textCipher,
      clock: deps.clock,
      logger: deps.logger,
    }),
    retentionJobHandler({
      chunks: deps.chunks,
      chunkStore: deps.chunkStore,
      clock: deps.clock,
      logger: deps.logger,
      housekeeping: {
        meetings: deps.meetings,
        requestDeletion: async (ownerId, meetingId) => {
          await requestMeetingDeletion(
            { meetings: deps.meetings, clock: deps.clock },
            ownerId,
            meetingId,
            "retention",
          );
        },
        requeueFailedDeletions: (ownerId, now) => deps.jobs.requeueFailed(ownerId, "delete", now),
      },
    }),
    deleteJobHandler({
      meetings: deps.meetings,
      chunkStore: deps.chunkStore,
      clock: deps.clock,
      logger: deps.logger,
    }),
  ];
}

/**
 * Runs due jobs once: every owner's for the interval runner's tick, or only `ownerId`'s for the
 * dev/test endpoint (so one owner's run never advances another owner's jobs).
 */
export async function runJobsNow(ownerId?: string): Promise<{ ran: number }> {
  const deps = getTranscribeDeps();
  const settings = new SqliteSettingsRepository(getDatabase());
  await scheduleRetentionJobs({
    chunks: deps.chunks,
    jobs: deps.jobs,
    clock: deps.clock,
    extraOwners: async () => [
      ...(await settings.ownersWithNoteRetention()),
      ...(await deps.jobs.ownersWithFailed("delete")),
    ],
  });
  return runDueJobs(
    ownerId === undefined ? getRunnerDeps() : { ...getRunnerDeps(), ownerId },
    getJobHandlers(),
  );
}

const JOB_TICK_MS = 2_000;
let runnerStarted = false;
let ticking = false;

/**
 * Starts the in-process job runner once per Node process (local development, tests, single-server
 * deployments). Disable with WILLY_JOB_RUNNER=off; on Cloudflare a Queue consumer and a cron
 * trigger call `runDueJobs` instead. Ticks never overlap and failures are logged, not swallowed.
 */
export function ensureJobRunner(): void {
  if (runnerStarted || process.env["WILLY_JOB_RUNNER"] === "off") return;
  runnerStarted = true;
  const timer = setInterval(() => {
    if (ticking) return;
    ticking = true;
    runJobsNow()
      .catch((cause: unknown) => {
        getLogger().error("runner.tick_failed", {
          errorName: cause instanceof Error ? cause.name : "unknown",
        });
      })
      .finally(() => {
        ticking = false;
      });
  }, JOB_TICK_MS);
  timer.unref();
}

export function getStatusDeps(): StatusDeps {
  const deps = getTranscribeDeps();
  return { meetings: deps.meetings, chunks: deps.chunks, jobs: deps.jobs };
}

let catalog: SqliteMeetingCatalog | undefined;

function getMeetingCatalog(): SqliteMeetingCatalog {
  catalog ??= new SqliteMeetingCatalog(getDatabase(), new RandomIds(), new SystemClock());
  return catalog;
}

export function getHomeDeps(): HomeDeps {
  return { list: getMeetingCatalog(), folders: getNotesDeps().folders, clock: new SystemClock() };
}

export function getCreateMeetingDeps(): CreateMeetingDeps {
  return { creation: getMeetingCatalog(), notes: getNotesDeps() };
}

/**
 * CALENDAR_PROVIDER=fake (default) uses the labelled demo calendar. FAKE_CALENDAR_DOWN_OWNERS
 * (comma separated owner ids) simulates an outage for those owners so the failure state can be
 * shown and tested. The Google provider needs its connect flow and a persistent credential
 * store, which are not wired yet, so it reports "not connected" instead of pretending.
 */
function getCalendarSource(): CalendarSource {
  const config = readCalendarConfig(process.env);
  if (config.ok && config.value.mode === "fake") {
    const down = (process.env["FAKE_CALENDAR_DOWN_OWNERS"] ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    return createFixtureCalendarSource({ now: () => new Date(), downOwners: down });
  }
  const message = config.ok
    ? "Google Calendar is not connected yet"
    : "calendar integration is not configured";
  return { listEvents: () => Promise.resolve(err(providerError("rejected", message))) };
}

export function getCalendarImportDeps(): ImportDeps {
  return {
    calendar: getCalendarSource(),
    repo: getMeetingCatalog(),
    retry: {
      policy: { maxAttempts: 3, baseMs: 200, capMs: 1500 },
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      random: () => Math.random(),
    },
  };
}

export function getLiveNoteDeps(): LiveNoteDeps {
  return {
    detail: getMeetingCatalog(),
    notes: getMeetingCatalog(),
    chunks: new SqliteChunkRepository(getDatabase()),
    clock: new SystemClock(),
  };
}

/**
 * Length of each uploaded audio chunk. 10 seconds by default; WILLY_CAPTURE_SEGMENT_MS lets
 * end-to-end runs use shorter chunks. Bounded to what the upload endpoint accepts.
 */
export function getCaptureSegmentMs(): number {
  const configured = Number(process.env["WILLY_CAPTURE_SEGMENT_MS"]);
  return Number.isInteger(configured) && configured >= 1_000 && configured <= 60_000
    ? configured
    : 10_000;
}

let regenerateDeps: RegenerateDeps | undefined;

export function getRegenerateDeps(): RegenerateDeps {
  if (!regenerateDeps) {
    const { meetings, clock } = getMeetingDeps();
    regenerateDeps = {
      meetings,
      notes: new SqliteNoteRepository(getDatabase(), new RandomIds()),
      jobs: getJobRepository(),
      clock,
    };
  }
  return regenerateDeps;
}

let reviewDeps: ReviewFormDeps | undefined;

export function getReviewDeps(): ReviewFormDeps {
  if (!reviewDeps) {
    const capture = getMeetingDeps();
    reviewDeps = {
      review: {
        reviews: new SqliteReviewRepository(getDatabase(), new RandomIds()),
        folders: getNotesDeps().folders,
        meetings: capture.meetings,
        textCipher: getTextCipher(),
        clock: capture.clock,
      },
      capture,
    };
  }
  return reviewDeps;
}

let observeDeps: ObserveDeps | undefined;

export function getObserveDeps(): ObserveDeps {
  observeDeps ??= {
    logger: getLogger(),
    now: () => Date.now(),
    newId: () => new RandomIds().newId(),
  };
  return observeDeps;
}

/** Provider names for diagnostics; a broken configuration is reported, never hidden. */
export function getDiagnosticsDeps(): DiagnosticsDeps {
  const stt = readSttConfig(process.env);
  const llm = readLlmConfig(process.env);
  const calendar = readCalendarConfig(process.env);
  return {
    diagnostics: new SqliteDiagnosticsRepository(getDatabase()),
    providers: {
      speechToText: stt.ok ? stt.value.mode : "misconfigured",
      summaries: llm.ok ? llm.value.mode : "misconfigured",
      calendar: calendar.ok ? calendar.value.mode : "misconfigured",
      storage: "local",
    },
  };
}

export function getSearchDeps(): SearchDeps {
  return { index: new SqliteSearchIndex(getDatabase()) };
}

export function getExportDeps(): ExportDeps {
  return { reader: new SqliteNoteReader(getDatabase()) };
}

/**
 * Settings screen (#19). Deletion itself stays `requestMeetingDeletion(getMeetingDeps(), ...)`
 * from #13: it is wired in as `meeting` and the settings use case only adds the typed
 * confirmation and the status read model.
 */
export function getDeletionDeps(): DeletionDeps {
  return {
    meeting: getMeetingDeps(),
    detail: getMeetingCatalog(),
    deletions: new SqliteDeletionStatusQuery(getDatabase()),
    jobs: getJobRepository(),
    clock: new SystemClock(),
  };
}

export function getRetentionDeps(): RetentionDeps {
  return { settings: new SqliteSettingsRepository(getDatabase()), clock: new SystemClock() };
}

/** Same provider modes as diagnostics; the Google calendar mode is selected but has no connect flow yet. */
export function getProviderStatusDeps(): ProviderStatusDeps {
  const { providers } = getDiagnosticsDeps();
  return {
    issues: new SqliteProviderIssueQuery(getDatabase()),
    modes: {
      calendar: providers.calendar,
      speech_to_text: providers.speechToText,
      summaries: providers.summaries,
      storage: providers.storage,
    },
    knownIssues:
      providers.calendar === "google" ? [{ code: "calendar_not_connected", at: null }] : [],
  };
}

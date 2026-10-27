import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { createChunkCipher } from "./adapters/crypto/chunk-cipher";
import { DEV_FILE_URL_SECRET, DEV_KEYRING } from "./adapters/crypto/dev-keyring";
import { parseKeyring } from "./adapters/crypto/envelope-cipher";
import { createFileTokenService, type FileTokenService } from "./adapters/crypto/file-tokens";
import { createLocalObjectStore } from "./adapters/fs/local-object-store";
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
import { SqliteMeetingRepository } from "./adapters/sqlite/meeting-repository";
import { SqliteFolderRepository } from "./adapters/sqlite/folder-repository";
import { SqliteOwnerRepository } from "./adapters/sqlite/owner-repository";
import { SqliteSessionRepository } from "./adapters/sqlite/session-repository";
import { SqliteTemplateRepository } from "./adapters/sqlite/template-repository";
import { RandomIds, SystemClock } from "./adapters/system/system";
import type { IdentityDeps } from "./app/identity/deps";
import { createChunkStore, type ChunkStore } from "./app/storage/chunk-store";
import type { MeetingDeps } from "./app/meetings/capture";
import type { UploadDeps } from "./app/transcription/upload-chunk";
import type { NotesDeps } from "./app/notes/deps";
import { DEFAULT_SIGN_IN_LIMITS, type SignInLimits } from "./app/identity/sign-in";
import type { Summarizer } from "./ports/summarizer";
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

/**
 * Encrypted audio chunk storage on the local disk (`<WILLY_DATA_DIR>/objects`). The Cloudflare
 * composition wires `createR2ObjectStore` with the R2 binding instead. Keys come from
 * ENCRYPTION_KEYS / ENCRYPTION_ACTIVE_KEY_ID; without them a fake dev key is used outside
 * production only.
 */
export function getChunkStore(): ChunkStore {
  if (!chunks) {
    const spec = process.env["ENCRYPTION_KEYS"];
    const activeKeyId = process.env["ENCRYPTION_ACTIVE_KEY_ID"];
    let keyring: { spec: string; activeKeyId: string };
    if (spec && activeKeyId) keyring = { spec, activeKeyId };
    else if (developmentFallbackAllowed()) keyring = DEV_KEYRING;
    else throw new Error("ENCRYPTION_KEYS and ENCRYPTION_ACTIVE_KEY_ID must be set in production");
    const dir = join(process.env["WILLY_DATA_DIR"] ?? "./data", "objects");
    chunks = createChunkStore({
      objects: createLocalObjectStore(dir),
      cipher: createChunkCipher(parseKeyring(keyring.spec), keyring.activeKeyId),
    });
  }
  return chunks;
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

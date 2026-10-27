import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
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
import { SqliteMeetingRepository } from "./adapters/sqlite/meeting-repository";
import { SqliteOwnerRepository } from "./adapters/sqlite/owner-repository";
import { SqliteSessionRepository } from "./adapters/sqlite/session-repository";
import { RandomIds, SystemClock } from "./adapters/system/system";
import type { IdentityDeps } from "./app/identity/deps";
import type { MeetingDeps } from "./app/meetings/capture";
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

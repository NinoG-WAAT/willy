import { backoffDelayMs, type BackoffPolicy } from "../../domain/platform/backoff";
import type { Clock } from "../../ports/clock";
import type { JobKind, JobRepository, JobRow } from "../../ports/job-repository";
import type { Logger } from "../../ports/logger";

export type JobOutcome =
  | { kind: "succeeded" }
  /** Transient problem: try again later (the runner schedules it, or gives up at max attempts). */
  | { kind: "retry"; errorCode: string }
  /** Permanent problem, or the handler already decided to give up. */
  | { kind: "failed"; errorCode: string };

export interface JobHandler {
  kind: JobKind;
  run(job: JobRow, log: Logger): Promise<JobOutcome>;
}

export interface RunnerDeps {
  jobs: JobRepository;
  clock: Clock;
  logger: Logger;
  /** In [0, 1); injected so backoff is deterministic in tests. */
  random: () => number;
  /** A `running` job untouched for this long is assumed orphaned and is taken over. */
  leaseMs: number;
}

export const RETRY_BASE_MS = 5_000;
export const RETRY_CAP_MS = 300_000;

const MAX_JOBS_PER_TICK = 20;

/**
 * Runs due jobs of the kinds that have a handler (other kinds stay pending for their own issue).
 * One database statement claims each job, so concurrent runners never double-run it; every
 * outcome is stored with attempt count and next retry time, and unexpected exceptions become
 * logged, redacted retries instead of being swallowed. Used by the in-process Node runner and,
 * on Cloudflare, by the queue consumer.
 */
export async function runDueJobs(
  deps: RunnerDeps,
  handlers: readonly JobHandler[],
  limit = MAX_JOBS_PER_TICK,
): Promise<{ ran: number }> {
  const kinds = handlers.map((h) => h.kind);
  let ran = 0;
  while (ran < limit) {
    const job = await deps.jobs.claimNext(deps.clock.now(), kinds, deps.leaseMs);
    if (!job) break;
    ran += 1;
    const handler = handlers.find((h) => h.kind === job.kind);
    if (handler) await runOne(deps, handler, job);
  }
  return { ran };
}

async function runOne(deps: RunnerDeps, handler: JobHandler, job: JobRow): Promise<void> {
  const log = deps.logger.child({
    jobId: job.id,
    jobKind: job.kind,
    ownerId: job.ownerId,
    meetingId: job.meetingId,
    attempt: job.attempts,
  });
  log.info("job.started", { maxAttempts: job.maxAttempts });

  let outcome: JobOutcome;
  try {
    outcome = await handler.run(job, log);
  } catch (cause) {
    // Never log the message: it may contain transcript or provider content.
    log.error("job.crashed", { errorName: cause instanceof Error ? cause.name : "unknown" });
    outcome = { kind: "retry", errorCode: "internal_error" };
  }

  const now = deps.clock.now();
  if (outcome.kind === "succeeded") {
    await deps.jobs.markSucceeded(job.id, now);
    log.info("job.succeeded");
  } else if (outcome.kind === "failed" || job.attempts >= job.maxAttempts) {
    await deps.jobs.markFailed(job.id, now, outcome.errorCode);
    log.error("job.failed", { errorCode: outcome.errorCode });
  } else {
    const policy: BackoffPolicy = {
      maxAttempts: job.maxAttempts,
      baseMs: RETRY_BASE_MS,
      capMs: RETRY_CAP_MS,
    };
    const delayMs = backoffDelayMs(job.attempts, policy, deps.random());
    const nextRunAt = new Date(now.getTime() + delayMs).toISOString();
    await deps.jobs.markRetrying(job.id, now, nextRunAt, outcome.errorCode);
    log.warn("job.retry_scheduled", { errorCode: outcome.errorCode, delayMs, nextRunAt });
  }
}

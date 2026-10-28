import type { JobStatus } from "./job-repository";

export interface DiagnosticsRepository {
  /** Highest applied migration number (for example "0001"), or null before any. */
  latestMigration(): Promise<string | null>;
  /** The owner's own job counts by status: never other owners' data. */
  jobCounts(ownerId: string): Promise<Record<JobStatus, number>>;
}

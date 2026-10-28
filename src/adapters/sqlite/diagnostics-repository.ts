import type { DatabaseSync } from "node:sqlite";
import type { DiagnosticsRepository } from "../../ports/diagnostics-repository";
import type { JobStatus } from "../../ports/job-repository";

export class SqliteDiagnosticsRepository implements DiagnosticsRepository {
  constructor(private readonly db: DatabaseSync) {}

  latestMigration(): Promise<string | null> {
    const row = this.db
      .prepare("SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1")
      .get();
    return Promise.resolve(row ? String(row["version"]) : null);
  }

  jobCounts(ownerId: string): Promise<Record<JobStatus, number>> {
    const counts: Record<JobStatus, number> = {
      pending: 0,
      running: 0,
      retrying: 0,
      succeeded: 0,
      failed: 0,
    };
    const rows = this.db
      .prepare("SELECT status, COUNT(*) AS n FROM job WHERE owner_id = ? GROUP BY status")
      .all(ownerId);
    for (const row of rows) {
      const status = String(row["status"]) as JobStatus;
      if (status in counts) counts[status] = Number(row["n"]);
    }
    return Promise.resolve(counts);
  }
}
